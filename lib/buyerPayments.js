import { isRefundDemoMode } from '@/lib/disputeRefund';
import { computeBuyerPaymentSummary } from '@/lib/buyerPaymentUi';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} buyerId
 */
export async function fetchBuyerPaymentsPayload(supabase, buyerId) {
  const { data: transactions, error: txErr } = await supabase
    .from('transactions')
    .select(
      `
      id,
      amount,
      currency,
      status,
      description,
      payment_confirmed_at,
      mpesa_receipt_number,
      mpesa_ref,
      mpesa_phone,
      completed_at,
      created_at,
      seller:seller_id (id, full_name, email)
    `
    )
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false });

  if (txErr) {
    return { ok: false, error: txErr.message || 'Could not load transactions' };
  }

  const txList = transactions || [];

  let refunds = [];
  let refundsMigrationRequired = false;

  const { data: refundRows, error: refErr } = await supabase
    .from('refund_requests')
    .select(
      `
      id,
      dispute_id,
      transaction_id,
      amount,
      phone,
      status,
      simulated,
      mpesa_transaction_id,
      result_desc,
      created_at,
      completed_at,
      dispute:dispute_id (id, resolution, status)
    `
    )
    .eq('buyer_id', buyerId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (refErr) {
    const msg = String(refErr.message || '').toLowerCase();
    if (refErr.code === '42P01' || msg.includes('refund_requests')) {
      refundsMigrationRequired = true;
    } else {
      return { ok: false, error: refErr.message || 'Could not load refunds' };
    }
  } else {
    refunds = refundRows || [];
  }

  const payments = txList
    .filter((t) => t.payment_confirmed_at)
    .map((t) => ({
      id: t.id,
      transaction_id: t.id,
      type: 'payment',
      amount: Number(t.amount),
      currency: t.currency || 'KES',
      status: t.status,
      mpesa_receipt_number: t.mpesa_receipt_number,
      mpesa_ref: t.mpesa_ref,
      mpesa_phone: t.mpesa_phone,
      payment_confirmed_at: t.payment_confirmed_at,
      description: t.description || 'Escrow payment',
      seller: t.seller,
      created_at: t.payment_confirmed_at,
    }));

  const summary = computeBuyerPaymentSummary(txList, refunds);

  return {
    ok: true,
    summary,
    payments,
    refunds,
    transactions: txList,
    refund_demo_mode: isRefundDemoMode(),
    refunds_migration_required: refundsMigrationRequired,
  };
}
