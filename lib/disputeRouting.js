/**
 * Dispute routing & decision-support (Phase B). No automatic money movement.
 */

export function getDisputePriorityAmountKes() {
  const n = Number(process.env.DISPUTE_PRIORITY_AMOUNT_KES);
  return Number.isFinite(n) && n > 0 ? n : 50000;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{
 *   reason: string;
 *   amount: number;
 *   screening: 'cleared'|'held';
 *   transaction_id: string;
 *   evidenceCount: number;
 * }} input
 */
export async function computeDisputeRouting(supabase, input) {
  const { reason, amount, screening, transaction_id, evidenceCount } = input;

  const { data: shipRows } = await supabase
    .from('delivery_evidence')
    .select('id')
    .eq('transaction_id', transaction_id)
    .eq('submission_type', 'seller_ship')
    .limit(1);

  const { data: buyerReceiveRows } = await supabase
    .from('delivery_evidence')
    .select('id')
    .eq('transaction_id', transaction_id)
    .eq('submission_type', 'buyer_receive')
    .limit(1);

  const hasSellerShip = (shipRows?.length || 0) > 0;
  const hasBuyerReceive = (buyerReceiveRows?.length || 0) > 0;
  const amt = Number(amount) || 0;

  /** @type {'standard'|'priority'|'triage'|'auto_suggest'} */
  let dispute_queue = 'standard';
  let recommended_resolution = null;
  let recommended_reason = null;

  if (screening === 'held') {
    dispute_queue = 'triage';
  }

  if (['payment_issue', 'other'].includes(reason)) {
    dispute_queue = 'priority';
    recommended_reason = 'Ambiguous reason category — admin review required.';
  } else if (amt >= getDisputePriorityAmountKes()) {
    dispute_queue = dispute_queue === 'triage' ? 'triage' : 'priority';
    recommended_reason = recommended_reason || `Amount KES ${amt.toLocaleString()} exceeds priority threshold.`;
  }

  if (reason === 'item_not_received' && !hasSellerShip) {
    dispute_queue = dispute_queue === 'priority' ? 'priority' : 'auto_suggest';
    recommended_resolution = 'refund_buyer';
    recommended_reason =
      'No seller dispatch evidence on file — objective signal favours buyer not-received claim.';
  } else if (reason === 'item_not_as_described' && hasSellerShip && hasBuyerReceive && evidenceCount >= 2) {
    dispute_queue = dispute_queue === 'triage' ? 'triage' : 'auto_suggest';
    recommended_resolution = 'release_to_seller';
    recommended_reason =
      'Seller shipped and buyer confirmed delivery with photos — lean toward seller unless description mismatch is clear.';
  }

  return {
    dispute_queue,
    recommended_resolution,
    recommended_reason,
  };
}

/**
 * Patch dispute row after create (columns optional until migration 024).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} disputeId
 * @param {ReturnType<typeof computeDisputeRouting> extends Promise<infer R> ? R : never} routing
 */
export async function applyDisputeRouting(supabase, disputeId, routing) {
  const { error } = await supabase
    .from('disputes')
    .update({
      dispute_queue: routing.dispute_queue,
      recommended_resolution: routing.recommended_resolution,
      recommended_reason: routing.recommended_reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', disputeId);

  if (error && !String(error.message || '').toLowerCase().includes('dispute_queue')) {
    console.warn('[disputeRouting] apply failed:', error.message);
  }
  return { ok: !error || String(error.message || '').toLowerCase().includes('dispute_queue') };
}
