'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { formatKesAmount, refundStatusClass, refundStatusLabel } from '@/lib/buyerPaymentUi';

function paymentStatusLabel(status) {
  const map = {
    payment_pending: 'Awaiting payment',
    escrow: 'In escrow',
    delivered: 'Awaiting confirmation',
    disputed: 'In dispute',
    released: 'Completed — seller paid',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
  };
  return map[status] || status?.replace(/_/g, ' ') || status;
}

function paymentStatusClass(status) {
  const map = {
    escrow: 'bg-amber-100 text-amber-900',
    delivered: 'bg-purple-100 text-purple-900',
    disputed: 'bg-rose-100 text-rose-900',
    released: 'bg-emerald-100 text-emerald-900',
    refunded: 'bg-slate-100 text-slate-800',
  };
  return map[status] || 'bg-slate-100 text-slate-800';
}

export default function BuyerPaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightRefundId = searchParams.get('highlight');
  const { user, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [migrationHint, setMigrationHint] = useState(false);
  const [tab, setTab] = useState('all');
  const [data, setData] = useState({
    summary: null,
    payments: [],
    refunds: [],
    refund_demo_mode: false,
  });

  const loadPayments = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch('/api/buyer/payments', {
      headers: { Authorization: `Bearer ${session?.access_token || ''}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error || 'Could not load payment history');
      return false;
    }
    setMigrationHint(Boolean(body.refunds_migration_required));
    setError(null);
    setData({
      summary: body.summary || null,
      payments: Array.isArray(body.payments) ? body.payments : [],
      refunds: Array.isArray(body.refunds) ? body.refunds : [],
      refund_demo_mode: Boolean(body.refund_demo_mode),
    });
    return true;
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push('/auth/login');
      return;
    }
    const role = profile?.role;
    if (role === 'admin') {
      router.push('/dashboard/admin');
      return;
    }
    if (role !== 'buyer' && role !== 'buyer_seller') {
      router.push('/dashboard/seller');
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!cancelled) await loadPayments();
      } catch {
        if (!cancelled) setError('Something went wrong loading your payments.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, profile?.role, router, loadPayments]);

  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'payments' || t === 'refunds' || t === 'all') setTab(t);
  }, [searchParams]);

  const summary = data.summary;

  const timeline = useMemo(() => {
    const items = [
      ...data.payments.map((p) => ({ ...p, kind: 'payment', sortAt: p.created_at || p.payment_confirmed_at })),
      ...data.refunds.map((r) => ({ ...r, kind: 'refund', sortAt: r.completed_at || r.created_at })),
    ];
    items.sort((a, b) => new Date(b.sortAt || 0) - new Date(a.sortAt || 0));
    if (tab === 'payments') return items.filter((i) => i.kind === 'payment');
    if (tab === 'refunds') return items.filter((i) => i.kind === 'refund');
    return items;
  }, [data.payments, data.refunds, tab]);

  if (authLoading || (loading && !error)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Buyer</p>
          <h1 className="text-3xl font-bold text-slate-900">Payments & refunds</h1>
          <p className="mt-1 max-w-2xl text-slate-600">
            Every M-Pesa pay-in for escrow and every dispute refund back to your phone. Buyer funds are not stored in
            an in-app wallet — refunds go straight to M-Pesa.
          </p>
        </div>
        <Link href="/dashboard/buyer" className="text-sm font-semibold text-indigo-700 hover:text-indigo-800">
          ← Back to buyer dashboard
        </Link>
      </div>

      {profile?.role === 'buyer_seller' && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-950 shadow-sm">
          <p className="font-semibold">You also sell on Safe Hands</p>
          <p className="mt-1 text-sm">
            Seller earnings live in your{' '}
            <Link href="/dashboard/seller/wallet" className="font-semibold underline hover:text-emerald-900">
              Earnings & balance
            </Link>{' '}
            wallet — separate from buyer refunds shown here.
          </p>
        </div>
      )}

      {migrationHint && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
          <p className="font-semibold">Refund tracking migration required</p>
          <p className="mt-2 text-sm leading-relaxed">
            Run{' '}
            <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs">scripts/025_refund_requests.sql</code> in
            Supabase to see dispute refund receipts here, then refresh.
          </p>
        </div>
      )}

      {data.refund_demo_mode && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-950 shadow-sm">
          <p className="font-semibold">Demo refund mode is ON</p>
          <p className="mt-1 text-sm">
            <code className="rounded bg-white/80 px-1">REFUND_DEMO_MODE=true</code> — dispute refunds complete instantly
            with simulated M-Pesa receipts for presentations.
          </p>
        </div>
      )}

      {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">{error}</div>}

      {!error && summary && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-700 via-blue-700 to-cyan-700 p-6 text-white shadow-lg">
              <p className="text-xs font-medium uppercase tracking-wide text-blue-100/90">Total paid (escrow)</p>
              <p className="mt-2 text-3xl font-bold tracking-tight">{formatKesAmount(summary.total_paid)}</p>
              <p className="mt-3 text-xs text-blue-100/80">{summary.payment_count} confirmed M-Pesa payment(s)</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-6 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-900">Refunded to you</p>
              <p className="mt-2 text-3xl font-bold text-emerald-950">{formatKesAmount(summary.total_refunded)}</p>
              <p className="mt-2 text-xs text-emerald-800">{summary.refund_count} completed refund(s)</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-6 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-900">Still in escrow</p>
              <p className="mt-2 text-3xl font-bold text-amber-950">{formatKesAmount(summary.in_escrow)}</p>
              <p className="mt-2 text-xs text-amber-800">Held until delivery or dispute resolution</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Outcomes</p>
              <p className="mt-3 text-sm text-slate-700">
                <span className="font-semibold text-slate-900">{summary.released_to_seller_count}</span> completed to
                seller
              </p>
              <p className="mt-1 text-sm text-slate-700">
                <span className="font-semibold text-slate-900">{summary.refunded_transaction_count}</span> refunded
                transactions
              </p>
              {summary.pending_refunds > 0 && (
                <p className="mt-2 text-xs font-medium text-amber-800">
                  {formatKesAmount(summary.pending_refunds)} refund(s) processing
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-4 border-b border-slate-200 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Activity</h2>
                <p className="mt-1 text-sm text-slate-600">Payments you made and refunds you received.</p>
              </div>
              <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'payments', label: 'Payments' },
                  { id: 'refunds', label: 'Refunds' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTab(opt.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      tab === opt.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {timeline.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-600">
                {tab === 'refunds'
                  ? 'No dispute refunds yet — they appear here when an admin resolves a dispute in your favour.'
                  : tab === 'payments'
                    ? 'No confirmed M-Pesa payments yet. Pay for a transaction from its detail page.'
                    : 'No payment activity yet.'}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {timeline.map((item) =>
                  item.kind === 'payment' ? (
                    <li key={`pay-${item.id}`} className="flex flex-wrap items-start justify-between gap-3 p-6">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold uppercase text-indigo-900">
                            Payment
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${paymentStatusClass(item.status)}`}
                          >
                            {paymentStatusLabel(item.status)}
                          </span>
                        </div>
                        <p className="mt-2 font-semibold text-slate-900">{item.description}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          To {item.seller?.full_name || 'seller'}
                          {item.mpesa_receipt_number && (
                            <>
                              {' '}
                              · Receipt{' '}
                              <span className="font-mono text-slate-800">{item.mpesa_receipt_number}</span>
                            </>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.payment_confirmed_at
                            ? new Date(item.payment_confirmed_at).toLocaleString()
                            : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-slate-900">{formatKesAmount(item.amount)}</p>
                        <Link
                          href={`/dashboard/transactions/${item.transaction_id}`}
                          className="mt-2 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          View transaction →
                        </Link>
                      </div>
                    </li>
                  ) : (
                    <li
                      key={`ref-${item.id}`}
                      className={`flex flex-wrap items-start justify-between gap-3 p-6 ${
                        highlightRefundId === item.id ? 'bg-emerald-50/80 ring-2 ring-inset ring-emerald-300' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold uppercase text-emerald-900">
                            Refund
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${refundStatusClass(item.status)}`}
                          >
                            {refundStatusLabel(item.status)}
                          </span>
                          {item.simulated && (
                            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
                              demo
                            </span>
                          )}
                        </div>
                        <p className="mt-2 font-semibold text-slate-900">Dispute refund to {item.phone}</p>
                        {item.mpesa_transaction_id && (
                          <p className="mt-1 text-sm text-slate-600">
                            M-Pesa receipt{' '}
                            <span className="font-mono text-slate-800">{item.mpesa_transaction_id}</span>
                          </p>
                        )}
                        {item.result_desc && item.status === 'failed' && (
                          <p className="mt-1 text-xs text-rose-600">{item.result_desc}</p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">
                          {item.completed_at
                            ? new Date(item.completed_at).toLocaleString()
                            : item.created_at
                              ? new Date(item.created_at).toLocaleString()
                              : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-emerald-800">+{formatKesAmount(item.amount)}</p>
                        <Link
                          href={`/dashboard/transactions/${item.transaction_id}`}
                          className="mt-2 inline-block text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                        >
                          View transaction →
                        </Link>
                      </div>
                    </li>
                  )
                )}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
