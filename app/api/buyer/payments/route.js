import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser, unauthorizedResponse } from '@/lib/apiAuth';
import { fetchBuyerPaymentsPayload } from '@/lib/buyerPayments';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * GET /api/buyer/payments
 * Buyer payment history, dispute refunds, and summary totals.
 */
export async function GET(request) {
  try {
    const { user } = await getAuthenticatedUser(request);
    if (!user) return unauthorizedResponse();

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('role, full_name, phone_number')
      .eq('id', user.id)
      .single();

    if (profileError || !profile) {
      return Response.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (!['buyer', 'buyer_seller'].includes(profile.role)) {
      return Response.json(
        { error: 'Payment history is available for buyer accounts.' },
        { status: 403 }
      );
    }

    const payload = await fetchBuyerPaymentsPayload(supabase, user.id);
    if (!payload.ok) {
      return Response.json({ error: payload.error }, { status: 500 });
    }

    return Response.json({
      success: true,
      full_name: profile.full_name,
      phone_number: profile.phone_number,
      ...payload,
    });
  } catch (e) {
    console.error('GET /api/buyer/payments:', e);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
