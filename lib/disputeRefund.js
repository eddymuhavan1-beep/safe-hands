import { randomUUID } from 'crypto';

/**
 * Presentation / dev: simulate buyer M-Pesa refunds without Daraja B2C.
 * Set REFUND_DEMO_MODE=false only when live B2C refund is wired.
 */
export function isRefundDemoMode() {
  const v = process.env.REFUND_DEMO_MODE;
  if (v === 'false' || v === '0' || v === 'no') return false;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  return process.env.WITHDRAW_DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production';
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} transactionId
 */
export async function wasTransactionReleasedToSeller(supabase, transactionId) {
  const { data } = await supabase
    .from('transaction_release_settlements')
    .select('transaction_id')
    .eq('transaction_id', transactionId)
    .maybeSingle();
  return Boolean(data?.transaction_id);
}

/**
 * Process buyer refund (full or partial) after dispute resolution.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   disputeId: string;
 *   transactionId: string;
 *   buyerId: string;
 *   amount: number;
 *   partial?: boolean;
 * }} params
 */
export async function processDisputeRefund(supabase, params) {
  const { disputeId, transactionId, buyerId, amount, partial = false } = params;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    return { ok: false, error: 'Invalid refund amount' };
  }

  const alreadyReleased = await wasTransactionReleasedToSeller(supabase, transactionId);
  if (alreadyReleased && !isRefundDemoMode()) {
    return {
      ok: false,
      error: 'Funds already settled to seller wallet — manual clawback required.',
      code: 'REFUND_REQUIRES_MANUAL',
    };
  }

  const { data: buyer, error: bErr } = await supabase
    .from('users')
    .select('phone_number')
    .eq('id', buyerId)
    .single();

  if (bErr || !buyer?.phone_number) {
    return { ok: false, error: 'Buyer phone number required for M-Pesa refund' };
  }

  const demo = isRefundDemoMode();
  const refundId = randomUUID();
  const phone = String(buyer.phone_number).replace(/\D/g, '');
  const simulatedReceipt = demo ? `DEMO-RF-${refundId.replace(/-/g, '').slice(0, 12).toUpperCase()}` : null;

  const row = {
    id: refundId,
    dispute_id: disputeId,
    transaction_id: transactionId,
    buyer_id: buyerId,
    amount: amt,
    phone,
    status: demo ? 'completed' : 'pending',
    simulated: demo,
    mpesa_transaction_id: simulatedReceipt,
    result_desc: demo
      ? 'REFUND_DEMO_MODE — simulated M-Pesa B2C refund for presentation'
      : 'Awaiting live B2C refund (configure Daraja + REFUND_DEMO_MODE=false)',
    completed_at: demo ? new Date().toISOString() : null,
  };

  const { error: insErr } = await supabase.from('refund_requests').insert(row);
  if (insErr) {
    if (insErr.code === '42P01' || String(insErr.message || '').includes('refund_requests')) {
      return {
        ok: true,
        simulated: demo,
        refund_id: null,
        mpesa_transaction_id: simulatedReceipt,
        skipped_table: true,
        message: demo
          ? 'Refund simulated (run scripts/025_refund_requests.sql to persist refund rows)'
          : 'Refund queued in app logic only — migration 025 required',
      };
    }
    return { ok: false, error: insErr.message };
  }

  return {
    ok: true,
    simulated: demo,
    refund_id: refundId,
    mpesa_transaction_id: simulatedReceipt,
    partial,
  };
}

/**
 * Credit seller wallet adjustment (partial refund remainder).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ sellerId: string; transactionId: string; amount: number; disputeId: string }} p
 */
export async function creditSellerPartialRemainder(supabase, p) {
  const amt = Number(p.amount);
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, error: 'Invalid amount' };

  const { data: seller, error: sErr } = await supabase
    .from('users')
    .select('account_balance')
    .eq('id', p.sellerId)
    .single();

  if (sErr || !seller) return { ok: false, error: 'Seller not found' };

  const bal = Number(seller.account_balance) || 0;
  const { error: uErr } = await supabase
    .from('users')
    .update({ account_balance: bal + amt, updated_at: new Date().toISOString() })
    .eq('id', p.sellerId);

  if (uErr) return { ok: false, error: uErr.message };

  await supabase.from('wallet_ledger_entries').insert({
    user_id: p.sellerId,
    transaction_id: p.transactionId,
    entry_type: 'adjustment',
    amount: amt,
    currency: 'KES',
    description: `Partial dispute settlement (seller share) — dispute ${p.disputeId.slice(0, 8)}`,
    metadata: { dispute_id: p.disputeId, simulated: isRefundDemoMode() },
  });

  return { ok: true };
}
