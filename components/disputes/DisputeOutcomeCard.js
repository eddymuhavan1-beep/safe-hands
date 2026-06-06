'use client';

import Link from 'next/link';
import {
  getFundMovementSummary,
  getResolutionVerdictLabel,
  getDisputeQueueLabel,
} from '@/lib/disputeResolutionLabels';

/**
 * @param {{
 *   dispute: Record<string, unknown>;
 *   transaction?: { id?: string; status?: string; amount?: number } | null;
 *   resolverName?: string | null;
 *   refundRequest?: { mpesa_transaction_id?: string; simulated?: boolean; status?: string; amount?: number } | null;
 *   demoMode?: boolean;
 * }} props
 */
export default function DisputeOutcomeCard({
  dispute,
  transaction,
  resolverName,
  refundRequest,
  demoMode = false,
}) {
  if (!dispute?.resolution && dispute?.status !== 'resolved' && dispute?.status !== 'closed') {
    return null;
  }

  const amount = Number(transaction?.amount ?? 0);
  const simulated = demoMode || Boolean(refundRequest?.simulated);

  return (
    <section className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Dispute outcome</p>
          <h2 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            {getResolutionVerdictLabel(String(dispute.resolution || ''))}
          </h2>
        </div>
        {simulated && (
          <span className="rounded-full bg-amber-100 text-amber-900 text-sm font-semibold px-3 py-1">
            Presentation demo
          </span>
        )}
      </div>

      {dispute.dispute_queue && (
        <p className="text-sm text-slate-700 mb-2">
          <span className="font-semibold">Queue:</span> {getDisputeQueueLabel(String(dispute.dispute_queue))}
        </p>
      )}

      <div className="rounded-xl bg-white border border-emerald-100 p-4 mb-4">
        <p className="text-base font-semibold text-slate-900 mb-2">Fund movement</p>
        <p className="text-sm sm:text-base text-slate-800 leading-relaxed">
          {getFundMovementSummary(String(dispute.resolution || ''), amount, { simulated })}
        </p>
        {transaction?.status && (
          <p className="text-sm text-slate-600 mt-3">
            Transaction status after resolution:{' '}
            <span className="font-semibold capitalize">{String(transaction.status).replace(/_/g, ' ')}</span>
          </p>
        )}
        {refundRequest?.mpesa_transaction_id && (
          <p className="text-sm text-slate-600 mt-2 font-mono">
            M-Pesa receipt: {refundRequest.mpesa_transaction_id}
          </p>
        )}
      </div>

      {dispute.admin_notes && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-slate-900 mb-1">Admin reasoning</p>
          <p className="text-sm sm:text-base text-slate-800 whitespace-pre-wrap leading-relaxed">
            {String(dispute.admin_notes)}
          </p>
        </div>
      )}

      <dl className="grid sm:grid-cols-2 gap-3 text-sm text-slate-700">
        {dispute.resolved_at && (
          <div>
            <dt className="font-semibold text-slate-900">Resolved</dt>
            <dd>{new Date(String(dispute.resolved_at)).toLocaleString()}</dd>
          </div>
        )}
        {resolverName && (
          <div>
            <dt className="font-semibold text-slate-900">Resolved by</dt>
            <dd>{resolverName}</dd>
          </div>
        )}
      </dl>

      {transaction?.id && (
        <Link
          href={`/dashboard/transactions/${transaction.id}`}
          className="inline-block mt-4 text-sm font-semibold text-blue-700 hover:text-blue-900"
        >
          View transaction →
        </Link>
      )}
    </section>
  );
}
