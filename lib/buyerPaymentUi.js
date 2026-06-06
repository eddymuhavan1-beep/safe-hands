/** Transaction statuses where buyer funds are still held in escrow flow */
export const BUYER_ESCROW_HELD_STATUSES = ['payment_pending', 'escrow', 'delivered', 'disputed'];

/**
 * @param {Array<{ amount?: number|string, status?: string, payment_confirmed_at?: string|null }>} transactions
 * @param {Array<{ amount?: number|string, status?: string }>} refunds
 */
export function computeBuyerPaymentSummary(transactions, refunds) {
  const txns = transactions || [];
  const refs = refunds || [];

  let totalPaid = 0;
  let inEscrow = 0;
  let paymentCount = 0;

  for (const t of txns) {
    if (!t.payment_confirmed_at) continue;
    const amt = Number(t.amount);
    if (!Number.isFinite(amt)) continue;
    totalPaid += amt;
    paymentCount += 1;
    if (BUYER_ESCROW_HELD_STATUSES.includes(String(t.status))) {
      inEscrow += amt;
    }
  }

  let totalRefunded = 0;
  let refundCount = 0;
  let pendingRefunds = 0;

  for (const r of refs) {
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    if (r.status === 'completed') {
      totalRefunded += amt;
      refundCount += 1;
    } else if (r.status === 'pending' || r.status === 'processing') {
      pendingRefunds += amt;
    }
  }

  const releasedToSeller = txns.filter((t) => t.status === 'released' && t.payment_confirmed_at).length;
  const refundedTransactions = txns.filter((t) => t.status === 'refunded').length;

  return {
    total_paid: totalPaid,
    total_refunded: totalRefunded,
    in_escrow: inEscrow,
    pending_refunds: pendingRefunds,
    payment_count: paymentCount,
    refund_count: refundCount,
    released_to_seller_count: releasedToSeller,
    refunded_transaction_count: refundedTransactions,
    currency: 'KES',
  };
}

export function formatKesAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function refundStatusLabel(status) {
  const map = {
    completed: 'Sent to M-Pesa',
    processing: 'Processing',
    pending: 'Pending',
    failed: 'Failed',
  };
  return map[status] || status;
}

export function refundStatusClass(status) {
  const map = {
    completed: 'bg-emerald-100 text-emerald-900',
    processing: 'bg-amber-100 text-amber-900',
    pending: 'bg-slate-100 text-slate-800',
    failed: 'bg-rose-100 text-rose-900',
  };
  return map[status] || 'bg-slate-100 text-slate-800';
}
