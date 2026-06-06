import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/apiAuth';
import { mapToCanonicalResolution, resolveDisputeAsAdmin } from '@/lib/disputeResolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * POST /api/admin/disputes/[id]/resolve
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { user } = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userError || !userData || userData.role !== 'admin') {
      return Response.json({ error: 'Only admins can resolve disputes' }, { status: 403 });
    }

    const body = await request.json();
    const resolution = mapToCanonicalResolution(body?.resolution, body?.decision);

    const result = await resolveDisputeAsAdmin(supabase, {
      disputeId: id,
      adminUserId: user.id,
      resolution: resolution || '',
      admin_notes: body?.admin_notes,
    });

    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status || 500 });
    }

    return Response.json({
      success: true,
      message: 'Dispute resolved successfully',
      resolution: result.resolution,
      verdict_label: result.verdict_label,
      transaction_status: result.transaction_status,
      refund_demo_mode: result.refund_demo_mode,
      refund: result.refund,
    });
  } catch (error) {
    console.error('Admin dispute resolution error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
