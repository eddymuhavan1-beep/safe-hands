/**
 * Human-readable dispute resolution copy for UI and notifications.
 */

/** @param {string} resolution */
export function getResolutionVerdictLabel(resolution) {
  const map = {
    refund_buyer: 'Buyer wins — full refund',
    release_to_seller: 'Seller wins — funds released',
    partial_refund: 'Split decision — partial refund',
    cancelled: 'Dispute cancelled — no payout change',
  };
  return map[resolution] || resolution?.replace(/_/g, ' ') || 'Unknown';
}

/** @param {string} resolution @param {number} amount @param {{ simulated?: boolean }} [opts] */
export function getFundMovementSummary(resolution, amount, opts = {}) {
  const amt = Number(amount);
  const safe = Number.isFinite(amt) ? amt : 0;
  const demo = opts.simulated ? ' (demo simulation for presentation)' : '';
  const half = Math.floor(safe / 2);

  switch (resolution) {
    case 'refund_buyer':
      return `KES ${safe.toLocaleString()} returned to the buyer via M-Pesa refund${demo}. Seller does not receive escrow payout.`;
    case 'release_to_seller':
      return `KES ${safe.toLocaleString()} released to the seller's wallet (escrow settlement)${demo}. Buyer is not refunded.`;
    case 'partial_refund':
      return `KES ${half.toLocaleString()} refunded to the buyer and KES ${(safe - half).toLocaleString()} credited to the seller${demo}.`;
    case 'cancelled':
      return 'No automatic fund movement. Transaction marked cancelled; review admin notes for manual steps if any.';
    default:
      return 'Fund movement depends on the admin verdict.';
  }
}

/** @param {string} resolution @param {'buyer'|'seller'} party @param {number} amount */
export function getPartyOutcomeMessage(resolution, party, amount) {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const half = Math.floor(safe / 2);

  if (resolution === 'refund_buyer') {
    return party === 'buyer'
      ? `You won the dispute. A refund of KES ${safe.toLocaleString()} has been processed to your M-Pesa.`
      : `The buyer won this dispute. Escrow funds were not released to you.`;
  }
  if (resolution === 'release_to_seller') {
    return party === 'seller'
      ? `You won the dispute. KES ${safe.toLocaleString()} has been released to your wallet.`
      : `The seller won this dispute. Your payment was not refunded.`;
  }
  if (resolution === 'partial_refund') {
    return party === 'buyer'
      ? `Split verdict: KES ${half.toLocaleString()} refunded to your M-Pesa; the remainder went to the seller.`
      : `Split verdict: KES ${(safe - half).toLocaleString()} credited to your wallet; the buyer received a partial refund.`;
  }
  if (resolution === 'cancelled') {
    return 'This dispute was closed without a payout verdict. See admin notes for details.';
  }
  return 'The dispute has been resolved.';
}

/** @param {string} resolution @param {number} amount @param {{ simulated?: boolean }} [opts] */
export function buildDisputeResolvedNotification(resolution, amount, opts = {}) {
  const verdict = getResolutionVerdictLabel(resolution);
  const funds = getFundMovementSummary(resolution, amount, opts);
  const sim = opts.simulated ? ' [Presentation demo mode]' : '';
  return {
    title: 'Dispute resolved',
    message: `${verdict}.${sim} ${funds}`,
  };
}

/** @param {string} queue */
export function getDisputeQueueLabel(queue) {
  const map = {
    standard: 'Standard queue',
    priority: 'Priority — needs senior review',
    triage: 'Triage — thin evidence filing',
    auto_suggest: 'Suggested outcome available',
  };
  return map[queue] || queue;
}
