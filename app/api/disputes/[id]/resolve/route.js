import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/apiAuth';
import { mapToCanonicalResolution, resolveDisputeAsAdmin } from '@/lib/disputeResolve';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** @deprecated Prefer POST /api/admin/disputes/[id]/resolve — delegates to shared resolver. */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const { user } = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { data: userData } = await supabase.from('users').select('role').eq('id', user.id).single();
    if (!userData || userData.role !== 'admin') {
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
      refund_demo_mode: result.refund_demo_mode,
    });
  } catch (error) {
    console.error('Dispute resolution error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
