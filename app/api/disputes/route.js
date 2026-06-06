import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/apiAuth';
import {
  uploadEvidenceFilesToBucket,
  MAX_FILES_DISPUTE_CREATE,
} from '@/lib/evidenceUpload';
import { validateDisputeDescription, createDisputeWithRpcOrFallback } from '@/lib/disputeCreate';
import { computeDisputeRouting, applyDisputeRouting } from '@/lib/disputeRouting';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseStorage = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DISPUTABLE_STATUSES = ['escrow', 'delivered'];

/**
 * POST /api/disputes
 * Create a new dispute. Multipart only; requires at least one image.
 * Allowed while transaction is in escrow or delivered (awaiting buyer confirmation).
 */
export async function POST(request) {
  try {
    const { user } = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return Response.json(
        {
          error:
            'Disputes must be submitted as multipart/form-data with fields transaction_id, reason, description, and at least one file in "files".',
        },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const transaction_id = formData.get('transaction_id');
    const reason = formData.get('reason');
    const description = formData.get('description');

    const amount_impact = formData.get('amount_impact');
    const timeline_notes = formData.get('timeline_notes');

    const check_not_received = formData.get('check_not_received') === 'true';
    const check_condition_mismatch = formData.get('check_condition_mismatch') === 'true';
    const check_timeline_discrepancy = formData.get('check_timeline_discrepancy') === 'true';

    const files = formData
      .getAll('files')
      .filter((f) => f && typeof f.arrayBuffer === 'function');

    const { error: uploadError, urls: uploadedEvidenceUrls } = await uploadEvidenceFilesToBucket(
      supabaseStorage,
      user.id,
      files,
      'dispute/create',
      { maxFiles: MAX_FILES_DISPUTE_CREATE }
    );

    if (uploadError) {
      return Response.json({ error: uploadError }, { status: 400 });
    }

    if (uploadedEvidenceUrls.length < 1) {
      return Response.json(
        { error: 'At least one image is required as dispute evidence.' },
        { status: 400 }
      );
    }

    const descriptionStr = typeof description === 'string' ? description.trim() : '';
    if (!transaction_id || !reason || !descriptionStr) {
      return Response.json(
        { error: 'Missing required fields: transaction_id, reason, description' },
        { status: 400 }
      );
    }

    const descCheck = validateDisputeDescription(descriptionStr);
    if (!descCheck.ok) {
      return Response.json({ error: descCheck.error }, { status: 400 });
    }

    const validReasons = ['item_not_received', 'item_not_as_described', 'payment_issue', 'other'];
    if (!validReasons.includes(reason)) {
      return Response.json(
        { error: `Invalid reason. Must be one of: ${validReasons.join(', ')}` },
        { status: 400 }
      );
    }

    const { data: transaction, error: transactionError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', transaction_id)
      .single();

    if (transactionError || !transaction) {
      return Response.json({ error: 'Transaction not found' }, { status: 404 });
    }

    if (transaction.buyer_id !== user.id && transaction.seller_id !== user.id) {
      return Response.json(
        { error: 'You can only dispute transactions you are involved in' },
        { status: 403 }
      );
    }

    if (!DISPUTABLE_STATUSES.includes(transaction.status)) {
      return Response.json(
        {
          error: `Disputes can only be opened while the transaction is in escrow or delivered (current status: ${transaction.status}).`,
        },
        { status: 400 }
      );
    }

    const { data: existingDispute } = await supabase
      .from('disputes')
      .select('id')
      .eq('transaction_id', transaction_id)
      .maybeSingle();

    if (existingDispute) {
      return Response.json({ error: 'A dispute already exists for this transaction' }, { status: 400 });
    }

    const raised_by = user.id;
    const raised_against = transaction.buyer_id === user.id ? transaction.seller_id : transaction.buyer_id;

    const disputeEvidenceNotes = [
      descriptionStr,
      amount_impact ? `Amount impact: ${amount_impact}` : null,
      check_not_received ? 'Checklist: Not received' : null,
      check_condition_mismatch ? 'Checklist: Condition mismatch / not as described' : null,
      check_timeline_discrepancy ? 'Checklist: Timeline discrepancy' : null,
      timeline_notes ? `Timeline notes: ${timeline_notes}` : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    const submission_type =
      transaction.buyer_id === user.id ? 'buyer_additional' : 'seller_additional';

    let screening = 'cleared';
    if (uploadedEvidenceUrls.length < 2 && descriptionStr.length < 120) {
      screening = 'held';
    }

    const { disputeId, error: createErr } = await createDisputeWithRpcOrFallback(supabase, {
      transaction_id,
      raised_by,
      raised_against,
      reason,
      description: descriptionStr,
      evidence_urls: uploadedEvidenceUrls,
      dispute_evidence_notes: disputeEvidenceNotes,
      submission_type,
      old_tx_status: transaction.status,
      screening,
    });

    if (createErr || !disputeId) {
      console.error('Dispute creation error:', createErr);
      return Response.json(
        { error: createErr || 'Failed to create dispute' },
        { status: 500 }
      );
    }

    const routing = await computeDisputeRouting(supabase, {
      reason,
      amount: transaction.amount,
      screening,
      transaction_id,
      evidenceCount: uploadedEvidenceUrls.length,
    });
    await applyDisputeRouting(supabase, disputeId, routing);

    const { data: dispute, error: fetchDisputeErr } = await supabase
      .from('disputes')
      .select('*')
      .eq('id', disputeId)
      .single();

    if (fetchDisputeErr || !dispute) {
      return Response.json({ error: 'Dispute created but could not be loaded' }, { status: 500 });
    }

    await supabase.from('notifications').insert({
      user_id: raised_against,
      title: 'Dispute Raised',
      message: `A dispute has been raised against you for transaction KES ${Number(transaction.amount).toLocaleString()}`,
      type: 'dispute_raised',
      related_transaction_id: transaction_id,
    });

    if (screening === 'cleared') {
      const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');

      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabase.from('notifications').insert({
            user_id: admin.id,
            title: 'New Dispute Requires Review',
            message: `A new dispute has been raised for transaction KES ${Number(transaction.amount).toLocaleString()}`,
            type: 'dispute_review',
            related_transaction_id: transaction_id,
          });
        }
      }
    } else {
      const { data: admins } = await supabase.from('users').select('id').eq('role', 'admin');
      if (admins && admins.length > 0) {
        for (const admin of admins) {
          await supabase.from('notifications').insert({
            user_id: admin.id,
            title: 'Dispute filed (triage)',
            message: `A dispute was filed with minimal evidence for transaction KES ${Number(transaction.amount).toLocaleString()}. Review the screening queue.`,
            type: 'dispute_review',
            related_transaction_id: transaction_id,
          });
        }
      }
    }

    return Response.json(
      {
        success: true,
        dispute,
        submission_screening: screening,
        routing,
        message:
          screening === 'held'
            ? 'Dispute created. It was placed in the admin triage queue because the filing had minimal evidence; an admin will still review it.'
            : routing.recommended_resolution
              ? 'Dispute created. The system suggested an outcome for admin review — no automatic payout.'
              : 'Dispute created successfully',
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Dispute API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/disputes
 * Get disputes for the authenticated user
 */
export async function GET(request) {
  try {
    const { user } = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const screening = searchParams.get('screening');
    const queue = searchParams.get('queue');

    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single();

    let query = supabase.from('disputes').select(`
        *,
        transaction:transactions (id, amount, description, status),
        raised_by_user:users!disputes_raised_by_fkey (id, full_name, email),
        raised_against_user:users!disputes_raised_against_fkey (id, full_name, email)
      `);

    if (userData?.role === 'admin') {
      if (status) {
        query = query.eq('status', status);
      }
    } else {
      query = query.or(`raised_by.eq.${user.id},raised_against.eq.${user.id}`);
      if (status) {
        query = query.eq('status', status);
      }
    }

    query = query.order('created_at', { ascending: false });

    const { data: disputes, error } = await query;

    if (error) {
      console.error('Dispute fetch error:', error);
      return Response.json({ error: 'Failed to fetch disputes' }, { status: 500 });
    }

    let list = disputes || [];
    if (userData?.role === 'admin' && screening && screening !== 'all') {
      list = list.filter((d) => (d.submission_screening || 'cleared') === screening);
    }
    if (userData?.role === 'admin' && queue && queue !== 'all') {
      list = list.filter((d) => (d.dispute_queue || 'standard') === queue);
    }

    return Response.json({
      success: true,
      disputes: list,
    });
  } catch (error) {
    console.error('Dispute API error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
