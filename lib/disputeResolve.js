import {
  buildDisputeResolvedNotification,
  getPartyOutcomeMessage,
  getResolutionVerdictLabel,
} from '@/lib/disputeResolutionLabels';
import {
  creditSellerPartialRemainder,
  isRefundDemoMode,
  processDisputeRefund,
  wasTransactionReleasedToSeller,
} from '@/lib/disputeRefund';

const VALID = ['refund_buyer', 'release_to_seller', 'partial_refund', 'cancelled'];

/**
 * Map admin UI decision aliases to canonical resolution.
 * @param {string|null|undefined} resolutionFromBody
 * @param {string|null|undefined} decision
 */
export function mapToCanonicalResolution(resolutionFromBody, decision) {
  if (resolutionFromBody && VALID.includes(resolutionFromBody)) return resolutionFromBody;
  if (decision === 'buyer_wins') return 'refund_buyer';
  if (decision === 'seller_wins') return 'release_to_seller';
  if (decision === 'split') return 'partial_refund';
  return null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ disputeId: string; adminUserId: string; resolution: string; admin_notes?: string|null }} input
 */
export async function resolveDisputeAsAdmin(supabase, input) {
  const { disputeId, adminUserId, resolution, admin_notes: adminNotesRaw } = input;
  const admin_notes = typeof adminNotesRaw === 'string' ? adminNotesRaw.trim() : '';

  if (!VALID.includes(resolution)) {
    return { ok: false, status: 400, error: `Invalid resolution. Must be one of: ${VALID.join(', ')}` };
  }

  if (!admin_notes || admin_notes.length < 10) {
    return {
      ok: false,
      status: 400,
      error: 'Admin notes required (at least 10 characters explaining the verdict).',
    };
  }

  const { data: dispute, error: disputeError } = await supabase
    .from('disputes')
    .select(`*, transaction:transactions (*)`)
    .eq('id', disputeId)
    .single();

  if (disputeError || !dispute) {
    return { ok: false, status: 404, error: 'Dispute not found' };
  }

  if (dispute.status === 'resolved' || dispute.status === 'closed') {
    return { ok: false, status: 400, error: 'Dispute has already been resolved' };
  }

  const transaction = dispute.transaction;
  if (!transaction?.id) {
    return { ok: false, status: 500, error: 'Linked transaction missing' };
  }

  const amount = Number(transaction.amount) || 0;
  const demo = isRefundDemoMode();

  let transactionStatus = 'disputed';
  /** @type {{ ok: boolean; simulated?: boolean; refund_id?: string|null; mpesa_transaction_id?: string|null; error?: string }|null} */
  let refundResult = null;

  if (resolution === 'refund_buyer') {
    transactionStatus = 'refunded';
    refundResult = await processDisputeRefund(supabase, {
      disputeId,
      transactionId: transaction.id,
      buyerId: transaction.buyer_id,
      amount,
    });
    if (!refundResult.ok && refundResult.code !== 'REFUND_REQUIRES_MANUAL') {
      return { ok: false, status: 502, error: refundResult.error || 'Refund failed' };
    }
  } else if (resolution === 'release_to_seller') {
    transactionStatus = 'released';
  } else if (resolution === 'cancelled') {
    transactionStatus = 'cancelled';
  } else if (resolution === 'partial_refund') {
    transactionStatus = 'refunded';
    const half = Math.floor(amount / 2);
    const remainder = amount - half;
    refundResult = await processDisputeRefund(supabase, {
      disputeId,
      transactionId: transaction.id,
      buyerId: transaction.buyer_id,
      amount: half,
      partial: true,
    });
    if (!refundResult.ok) {
      return { ok: false, status: 502, error: refundResult.error || 'Partial refund failed' };
    }
    const credit = await creditSellerPartialRemainder(supabase, {
      sellerId: transaction.seller_id,
      transactionId: transaction.id,
      amount: remainder,
      disputeId,
    });
    if (!credit.ok) {
      return { ok: false, status: 502, error: credit.error || 'Seller partial credit failed' };
    }
  }

  const { error: updateError } = await supabase
    .from('disputes')
    .update({
      status: 'resolved',
      resolution,
      admin_notes,
      resolved_by: adminUserId,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', disputeId);

  if (updateError) {
    return { ok: false, status: 500, error: 'Failed to resolve dispute' };
  }

  await supabase
    .from('transactions')
    .update({
      status: transactionStatus,
      is_disputed: false,
      completed_at:
        transactionStatus === 'released' || transactionStatus === 'refunded'
          ? new Date().toISOString()
          : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', transaction.id);

  await supabase.from('transaction_history').insert({
    transaction_id: transaction.id,
    old_status: transaction.status,
    new_status: transactionStatus,
    changed_by: adminUserId,
    reason: `${getResolutionVerdictLabel(resolution)}. ${admin_notes}`,
  });

  const notif = buildDisputeResolvedNotification(resolution, amount, { simulated: demo });
  const buyerMsg = getPartyOutcomeMessage(resolution, 'buyer', amount);
  const sellerMsg = getPartyOutcomeMessage(resolution, 'seller', amount);

  const buyerPaymentsHint =
    resolution === 'refund_buyer' || resolution === 'partial_refund'
      ? ' View Payments & refunds in your dashboard for receipt details.'
      : '';

  await supabase.from('notifications').insert([
    {
      user_id: transaction.buyer_id,
      title: notif.title,
      message: buyerMsg + buyerPaymentsHint + (demo ? ' [Demo simulation]' : ''),
      type: 'dispute_resolved',
      related_transaction_id: transaction.id,
    },
    {
      user_id: transaction.seller_id,
      title: notif.title,
      message: sellerMsg + (demo ? ' [Demo simulation]' : ''),
      type: 'dispute_resolved',
      related_transaction_id: transaction.id,
    },
  ]);

  return {
    ok: true,
    status: 200,
    resolution,
    transaction_status: transactionStatus,
    verdict_label: getResolutionVerdictLabel(resolution),
    refund_demo_mode: demo,
    refund: refundResult,
    already_released_to_seller: await wasTransactionReleasedToSeller(supabase, transaction.id),
  };
}
