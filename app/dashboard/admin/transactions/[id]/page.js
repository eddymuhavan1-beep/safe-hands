'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import DisputeOutcomeCard from '@/components/disputes/DisputeOutcomeCard';
import { getResolutionVerdictLabel } from '@/lib/disputeResolutionLabels';

export default function AdminTransactionAuditPage() {
  const { id } = useParams();
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [transaction, setTransaction] = useState(null);
  const [history, setHistory] = useState([]);
  const [evidence, setEvidence] = useState([]);
  const [dispute, setDispute] = useState(null);
  const [refund, setRefund] = useState(null);
  const [resolverName, setResolverName] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (profile?.role !== 'admin') {
      router.push('/dashboard');
      return;
    }
    load();
  }, [authLoading, profile, id, router]);

  const load = async () => {
    setLoading(true);
    try {
      const { data: txn, error: tErr } = await supabase
        .from('transactions')
        .select(`
          *,
          buyer:users!transactions_buyer_id_fkey (id, full_name, email, phone_number),
          seller:users!transactions_seller_id_fkey (id, full_name, email, phone_number)
        `)
        .eq('id', id)
        .single();

      if (tErr || !txn) throw tErr;

      setTransaction(txn);

      const { data: hist } = await supabase
        .from('transaction_history')
        .select('*')
        .eq('transaction_id', id)
        .order('created_at', { ascending: false });

      setHistory(hist || []);

      const { data: { session } } = await supabase.auth.getSession();
      const evRes = await fetch(`/api/transactions/${id}/evidence`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (evRes.ok) {
        const evJson = await evRes.json();
        setEvidence(evJson.evidence || []);
      }

      const { data: disp } = await supabase
        .from('disputes')
        .select('*')
        .eq('transaction_id', id)
        .maybeSingle();

      setDispute(disp || null);

      if (disp?.id) {
        const { data: ref } = await supabase
          .from('refund_requests')
          .select('*')
          .eq('dispute_id', disp.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setRefund(ref || null);

        if (disp.resolved_by) {
          const { data: resolver } = await supabase
            .from('users')
            .select('full_name, email')
            .eq('id', disp.resolved_by)
            .maybeSingle();
          setResolverName(resolver?.full_name || resolver?.email || 'Admin');
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-base text-slate-600">Loading audit record…</p>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-600 text-lg">Transaction not found</p>
        <Link href="/dashboard/admin/transactions" className="text-blue-600 mt-4 inline-block">
          ← Back to transactions
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div className="rounded-2xl border border-slate-200 bg-slate-900 text-white p-6">
        <Link href="/dashboard/admin/transactions" className="text-slate-300 hover:text-white text-sm">
          ← Admin transactions
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold mt-2">Transaction audit</h1>
        <p className="text-slate-300 mt-1 font-mono text-sm">{transaction.id}</p>
        <p className="text-lg mt-3">
          KES {Number(transaction.amount).toLocaleString()} ·{' '}
          <span className="capitalize">{String(transaction.status).replace(/_/g, ' ')}</span>
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">Buyer</p>
          <p className="text-base">{transaction.buyer?.full_name || '—'}</p>
          <p className="text-sm text-slate-600">{transaction.buyer?.email}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-semibold text-slate-900">Seller</p>
          <p className="text-base">{transaction.seller?.full_name || '—'}</p>
          <p className="text-sm text-slate-600">{transaction.seller?.email}</p>
        </div>
      </div>

      {dispute && (
        <div className="space-y-4">
          <div className="rounded-xl border border-violet-200 bg-violet-50 p-5">
            <p className="text-sm font-semibold text-violet-900">Linked dispute</p>
            <p className="text-base mt-1 capitalize">{dispute.reason?.replace(/_/g, ' ')}</p>
            <p className="text-sm text-violet-800 mt-1">Status: {dispute.status}</p>
            {dispute.resolution && (
              <p className="text-sm font-medium text-violet-900 mt-2">
                Verdict: {getResolutionVerdictLabel(dispute.resolution)}
              </p>
            )}
            <Link
              href={`/dashboard/disputes/${dispute.id}`}
              className="inline-block mt-3 text-sm font-semibold text-violet-700 hover:text-violet-900"
            >
              Open dispute file →
            </Link>
          </div>
          <DisputeOutcomeCard
            dispute={dispute}
            transaction={transaction}
            resolverName={resolverName}
            refundRequest={refund}
            demoMode={Boolean(refund?.simulated)}
          />
        </div>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Status history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-600">No history rows.</p>
        ) : (
          <ul className="space-y-3">
            {history.map((row) => (
              <li key={row.id} className="border-l-4 border-blue-500 pl-4 py-1">
                <p className="text-sm font-semibold text-slate-900">
                  {row.old_status || '—'} → {row.new_status}
                </p>
                <p className="text-sm text-slate-700">{row.reason}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {row.created_at ? new Date(row.created_at).toLocaleString() : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-bold text-slate-900 mb-4">Evidence timeline</h2>
        {evidence.length === 0 ? (
          <p className="text-sm text-slate-600">No evidence uploaded.</p>
        ) : (
          <ul className="space-y-4">
            {evidence.map((ev) => (
              <li key={ev.id} className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-semibold capitalize">{ev.submission_type?.replace(/_/g, ' ')}</p>
                <p className="text-xs text-slate-500">{new Date(ev.submitted_at).toLocaleString()}</p>
                {ev.photos?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ev.photos.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                        <img src={url} alt="" className="h-20 w-20 object-cover rounded border" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link
        href={`/dashboard/transactions/${id}`}
        className="inline-flex text-sm font-semibold text-blue-700 hover:text-blue-900"
      >
        Open buyer/seller transaction view (read-only for admin) →
      </Link>
    </div>
  );
}
