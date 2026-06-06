'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import DisputeOutcomeCard from '@/components/disputes/DisputeOutcomeCard';
import { getResolutionVerdictLabel, getDisputeQueueLabel } from '@/lib/disputeResolutionLabels';

const statusColors = {
  open: 'bg-blue-100 text-blue-700',
  in_review: 'bg-yellow-100 text-yellow-700',
  awaiting_response: 'bg-orange-100 text-orange-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
};

export default function AdminDisputesPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const [queueFilter, setQueueFilter] = useState('all');
  const [routeQueueFilter, setRouteQueueFilter] = useState('all');
  const [viewOutcomeDispute, setViewOutcomeDispute] = useState(null);
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalEvidence, setModalEvidence] = useState([]);
  const [modalEvidenceLoading, setModalEvidenceLoading] = useState(false);
  const [decision, setDecision] = useState('');
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // Check admin access and fetch disputes
  useEffect(() => {
    if (authLoading) return;
    
    if (!profile || profile.role !== 'admin') {
      router.push('/dashboard');
      setLoading(false);
      return;
    }
    
    fetchDisputes();
  }, [profile, authLoading, router]);

  useEffect(() => {
    if (!showModal || !selectedDispute?.transaction?.id) {
      setModalEvidence([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setModalEvidenceLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `/api/transactions/${selectedDispute.transaction.id}/evidence`,
          {
            headers: {
              Authorization: `Bearer ${session?.access_token || ''}`,
            },
          }
        );
        const j = await res.json();
        if (!cancelled && j.success) {
          setModalEvidence(j.evidence || []);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setModalEvidence([]);
      } finally {
        if (!cancelled) setModalEvidenceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showModal, selectedDispute?.transaction?.id]);

  const fetchDisputes = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('disputes')
        .select(`
          *,
          transaction:transactions(
            id,
            amount,
            description,
            status,
            buyer:users!transactions_buyer_id_fkey(full_name, email),
            seller:users!transactions_seller_id_fkey(full_name, email)
          )
        `)
        .order('created_at', { ascending: false });

      if (err) throw err;
      setDisputes(data || []);
    } catch (err) {
      console.error('[v0] Error fetching disputes:', err);
      setError('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  };

  const filteredDisputes = disputes.filter((dispute) => {
    if (filterStatus !== 'all' && dispute.status !== filterStatus) return false;
    if (queueFilter !== 'all') {
      const screening = dispute.submission_screening || 'cleared';
      if (screening !== queueFilter) return false;
    }
    if (routeQueueFilter !== 'all') {
      const rq = dispute.dispute_queue || 'standard';
      if (rq !== routeQueueFilter) return false;
    }
    return true;
  });

  const resolutionToDecision = (resolution) => {
    if (resolution === 'refund_buyer') return 'buyer_wins';
    if (resolution === 'release_to_seller') return 'seller_wins';
    if (resolution === 'partial_refund') return 'split';
    return '';
  };

  const applySuggestedDecision = () => {
    if (!selectedDispute?.recommended_resolution) return;
    const d = resolutionToDecision(selectedDispute.recommended_resolution);
    if (d) setDecision(d);
    if (selectedDispute.recommended_reason && !notes.trim()) {
      setNotes(`Applied system suggestion: ${selectedDispute.recommended_reason}`);
    }
  };

  const openModal = (dispute) => {
    setSelectedDispute(dispute);
    setShowModal(true);
    setActionMessage(null);
    setDecision('');
    setNotes('');
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedDispute(null);
    setDecision('');
    setNotes('');
    setActionMessage(null);
    setModalEvidence([]);
  };

  const handleResolveDispute = async () => {
    if (!selectedDispute || !decision) {
      setActionMessage({ type: 'error', text: 'Please select a decision' });
      return;
    }
    if (!notes.trim() || notes.trim().length < 10) {
      setActionMessage({ type: 'error', text: 'Admin notes must be at least 10 characters' });
      return;
    }

    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const decisionToResolutionMap = {
        buyer_wins: 'refund_buyer',
        seller_wins: 'release_to_seller',
        split: 'partial_refund',
      };

      const resolution = decisionToResolutionMap[decision];

      const response = await fetch(`/api/admin/disputes/${selectedDispute.id}/resolve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resolution,
          admin_notes: notes,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to resolve dispute');
      }

      // Refresh disputes list to reflect updated status and resolution
      await fetchDisputes();

      setActionMessage({
        type: 'success',
        text: 'Dispute resolved successfully',
      });
      toast.success(result.verdict_label || 'Dispute resolved successfully');

      setTimeout(closeModal, 1500);
    } catch (err) {
      console.error('[v0] Error resolving dispute:', err);
      setActionMessage({ type: 'error', text: 'Failed to resolve dispute' });
    } finally {
      setActionLoading(false);
    }
  };

  const renderModal = () => {
    if (!showModal || !selectedDispute) return null;

    return (
      <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-gray-200 sticky top-0 bg-white z-10">
            <h3 className="text-xl font-bold text-gray-900">Resolve Dispute</h3>
          </div>

          <div className="p-6 space-y-6">
            {/* Dispute Info */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold">Dispute ID</p>
                  <p className="font-mono text-sm font-semibold text-gray-900">#{selectedDispute.id.slice(0, 8)}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[selectedDispute.status]}`}>
                  {selectedDispute.status.replace('_', ' ')}
                </span>
              </div>

              <div>
                <p className="text-xs text-gray-600 uppercase font-semibold">Reason</p>
                <p className="text-sm text-gray-900">{selectedDispute.reason}</p>
              </div>

              <div>
                <p className="text-xs text-gray-600 uppercase font-semibold">Transaction Amount</p>
                <p className="text-lg font-bold text-gray-900">KES {selectedDispute.transaction?.amount?.toLocaleString() || 'N/A'}</p>
              </div>

                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-200">
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold mb-1">Buyer</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {selectedDispute.transaction?.buyer?.full_name || '—'}
                  </p>
                  <p className="text-xs text-gray-600">{selectedDispute.transaction?.buyer?.email}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold mb-1">Seller</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {selectedDispute.transaction?.seller?.full_name || '—'}
                  </p>
                  <p className="text-xs text-gray-600">{selectedDispute.transaction?.seller?.email}</p>
                </div>
              </div>

              {(selectedDispute.dispute_queue || selectedDispute.recommended_resolution) && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
                  <p className="font-semibold">
                    Route: {getDisputeQueueLabel(selectedDispute.dispute_queue || 'standard')}
                  </p>
                  {selectedDispute.recommended_resolution && (
                    <p className="mt-1">
                      Suggested: {getResolutionVerdictLabel(selectedDispute.recommended_resolution)}
                    </p>
                  )}
                  {selectedDispute.recommended_reason && (
                    <p className="mt-1 text-indigo-900">{selectedDispute.recommended_reason}</p>
                  )}
                  {selectedDispute.status === 'open' && selectedDispute.recommended_resolution && (
                    <button
                      type="button"
                      onClick={applySuggestedDecision}
                      className="mt-2 text-sm font-semibold text-indigo-700 underline"
                    >
                      Apply suggestion to decision form
                    </button>
                  )}
                </div>
              )}

              {(selectedDispute.submission_screening || 'cleared') === 'held' && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <strong>Triage queue:</strong> filed with minimal evidence (e.g. one photo and shorter narrative).
                  Review carefully before resolving.
                </div>
              )}

              {selectedDispute.description && (
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold">Buyer / seller statement</p>
                  <p className="text-sm text-gray-900 whitespace-pre-wrap mt-1">{selectedDispute.description}</p>
                </div>
              )}

              {selectedDispute.evidence_urls && selectedDispute.evidence_urls.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold mb-2">Images at filing</p>
                  <div className="grid grid-cols-3 gap-2">
                    {selectedDispute.evidence_urls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block rounded-lg overflow-hidden border border-gray-200 hover:opacity-90"
                      >
                        <img src={url} alt="" className="h-24 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-600 uppercase font-semibold mb-2">Full transaction evidence timeline</p>
                {modalEvidenceLoading ? (
                  <p className="text-sm text-gray-500">Loading timeline…</p>
                ) : modalEvidence.length === 0 ? (
                  <p className="text-sm text-gray-500">No structured evidence rows yet.</p>
                ) : (
                  <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                    {modalEvidence.map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-800"
                      >
                        <div className="flex justify-between gap-2 font-semibold text-gray-900">
                          <span>{ev.submission_type}</span>
                          <span className="text-gray-500 font-normal">
                            {ev.submitted_at ? new Date(ev.submitted_at).toLocaleString() : ''}
                          </span>
                        </div>
                        {ev.notes && <p className="mt-1 whitespace-pre-wrap">{ev.notes}</p>}
                        {ev.photos && ev.photos.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {ev.photos.map((u) => (
                              <a
                                key={u}
                                href={u}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block h-14 w-14 overflow-hidden rounded border border-gray-100"
                              >
                                <img src={u} alt="" className="h-full w-full object-cover" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Decision Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-3">Decision</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                    <input
                      type="radio"
                      name="decision"
                      value="buyer_wins"
                      checked={decision === 'buyer_wins'}
                      onChange={(e) => setDecision(e.target.value)}
                      className="w-4 h-4"
                    />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">Buyer Wins</p>
                      <p className="text-xs text-gray-600">Refund buyer, no payment to seller</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                    <input
                      type="radio"
                      name="decision"
                      value="seller_wins"
                      checked={decision === 'seller_wins'}
                      onChange={(e) => setDecision(e.target.value)}
                      className="w-4 h-4"
                    />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">Seller Wins</p>
                      <p className="text-xs text-gray-600">Release funds to seller, no refund</p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                    <input
                      type="radio"
                      name="decision"
                      value="split"
                      checked={decision === 'split'}
                      onChange={(e) => setDecision(e.target.value)}
                      className="w-4 h-4"
                    />
                    <div>
                      <p className="font-semibold text-gray-900 text-sm">Split 50/50</p>
                      <p className="text-xs text-gray-600">Divide funds equally between both parties</p>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Admin Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Explain your decision..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition resize-none"
                  rows="4"
                />
              </div>
            </div>

            {actionMessage && (
              <div className={`p-3 rounded-lg text-sm font-medium ${
                actionMessage.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}>
                {actionMessage.text}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={closeModal}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleResolveDispute}
                disabled={actionLoading || !decision}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Resolve Dispute'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 font-medium">Loading disputes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-700 via-indigo-700 to-blue-700 text-white p-8 shadow-lg">
        <h1 className="text-3xl font-bold tracking-tight">Manage Disputes</h1>
        <p className="text-indigo-100 mt-2">Review evidence, make fair decisions, and close disputes with complete audit clarity.</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <p className="text-red-700 font-medium text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-6">
        {/* Status Filter */}
        <div className="flex flex-wrap gap-2">
          {['all', 'open', 'in_review', 'awaiting_response', 'resolved', 'closed'].map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={`px-4 py-2.5 rounded-lg font-medium text-sm transition ${
                filterStatus === status
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {status === 'all' ? 'All' : status.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
          <span className="text-sm font-semibold text-gray-700">Evidence filing</span>
          {[
            { id: 'cleared', label: 'Standard filing' },
            { id: 'held', label: 'Thin filing (triage)' },
            { id: 'all', label: 'All filings' },
          ].map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setQueueFilter(q.id)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                queueFilter === q.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-sm font-semibold text-gray-700">Routing queue</span>
          {[
            { id: 'all', label: 'All routes' },
            { id: 'priority', label: 'Priority' },
            { id: 'triage', label: 'Triage' },
            { id: 'auto_suggest', label: 'Suggested' },
            { id: 'standard', label: 'Standard' },
          ].map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setRouteQueueFilter(q.id)}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition ${
                routeQueueFilter === q.id
                  ? 'bg-violet-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* Disputes List */}
        {filteredDisputes.length === 0 ? (
          <div className="py-12 text-center">
            <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4v.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-lg font-semibold text-gray-900">No disputes found</p>
            <p className="text-sm text-gray-600 mt-1">All transactions are progressing smoothly</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredDisputes.map((dispute) => (
              <div key={dispute.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-mono font-semibold text-gray-900">#{dispute.id.slice(0, 8)}</span>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusColors[dispute.status]}`}>
                        {dispute.status.replace('_', ' ')}
                      </span>
                      {(dispute.submission_screening || 'cleared') === 'held' && (
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900">
                          Triage
                        </span>
                      )}
                    </div>
                    <p className="text-base text-gray-800">{dispute.reason?.replace(/_/g, ' ')}</p>
                    <p className="text-sm text-gray-600 mt-2 line-clamp-2 leading-relaxed">
                      {dispute.description || 'No description'}
                    </p>
                    {(dispute.dispute_queue || dispute.recommended_resolution) && (
                      <p className="text-sm text-violet-700 font-medium mt-2">
                        {getDisputeQueueLabel(dispute.dispute_queue || 'standard')}
                        {dispute.recommended_resolution
                          ? ` · ${getResolutionVerdictLabel(dispute.recommended_resolution)}`
                          : ''}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-3">
                      <Link
                        href={`/dashboard/disputes/${dispute.id}`}
                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                      >
                        Open case & evidence →
                      </Link>
                      {dispute.transaction?.id && (
                        <Link
                          href={`/dashboard/admin/transactions/${dispute.transaction.id}`}
                          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
                        >
                          Audit transaction →
                        </Link>
                      )}
                    </div>
                    {Array.isArray(dispute.evidence_urls) && dispute.evidence_urls.length > 0 && (
                      <p className="text-xs text-gray-500 mt-2">
                        {dispute.evidence_urls.length} image(s) attached at filing
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() =>
                      dispute.status === 'resolved' || dispute.status === 'closed'
                        ? setViewOutcomeDispute(dispute)
                        : openModal(dispute)
                    }
                    disabled={dispute.status === 'closed'}
                    className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {dispute.status === 'resolved'
                      ? 'View outcome'
                      : dispute.status === 'closed'
                        ? 'Closed'
                        : 'Review'}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-gray-600 font-semibold mb-1">Amount</p>
                    <p className="font-bold text-gray-900">KES {dispute.transaction?.amount?.toLocaleString() || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-semibold mb-1">Buyer</p>
                    <p className="text-gray-900">{dispute.transaction?.buyer?.full_name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-semibold mb-1">Seller</p>
                    <p className="text-gray-900">{dispute.transaction?.seller?.full_name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-semibold mb-1">Filed</p>
                    <p className="text-gray-900">{new Date(dispute.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="pt-4 border-t border-gray-200 grid grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{filteredDisputes.filter(d => d.status === 'open').length}</p>
            <p className="text-sm text-gray-600">Open</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-yellow-600">{filteredDisputes.filter(d => d.status === 'in_review').length}</p>
            <p className="text-sm text-gray-600">In Review</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{filteredDisputes.filter(d => d.status === 'resolved').length}</p>
            <p className="text-sm text-gray-600">Resolved</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{filteredDisputes.length}</p>
            <p className="text-sm text-gray-600">Shown</p>
          </div>
        </div>
      </div>

      {renderModal()}

      {viewOutcomeDispute && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-xl font-bold text-slate-900">Resolved dispute outcome</h3>
              <button
                type="button"
                onClick={() => setViewOutcomeDispute(null)}
                className="text-sm font-semibold text-slate-600 hover:text-slate-900"
              >
                Close
              </button>
            </div>
            <DisputeOutcomeCard
              dispute={viewOutcomeDispute}
              transaction={viewOutcomeDispute.transaction}
              demoMode
            />
            {viewOutcomeDispute.transaction?.id && (
              <Link
                href={`/dashboard/admin/transactions/${viewOutcomeDispute.transaction.id}`}
                className="inline-block mt-4 text-sm font-semibold text-blue-700"
              >
                Full transaction audit →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
