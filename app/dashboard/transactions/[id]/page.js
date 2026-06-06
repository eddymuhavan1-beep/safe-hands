'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';
import { validateDisputeDescription, MIN_DESCRIPTION_LEN } from '@/lib/disputeCreate';
import EvidenceUploadPanel from '@/components/evidence/EvidenceUploadPanel';

export default function TransactionDetail() {
  const router = useRouter();
  const params = useParams();
  const { id } = params;
  const { user: authUser, profile, loading: authLoading } = useAuth();
  
  const [user, setUser] = useState(null);
  const [transaction, setTransaction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showShippingModal, setShowShippingModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [confirmationComment, setConfirmationComment] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeFiles, setDisputeFiles] = useState([]);
  const [amountImpact, setAmountImpact] = useState('');
  const [checkNotReceived, setCheckNotReceived] = useState(false);
  const [checkConditionMismatch, setCheckConditionMismatch] = useState(false);
  const [checkTimelineDiscrepancy, setCheckTimelineDiscrepancy] = useState(false);
  const [timelineNotes, setTimelineNotes] = useState('');
  const [sellerRequest, setSellerRequest] = useState(null);
  const [sellerMessage, setSellerMessage] = useState('');
  const [proposedAmount, setProposedAmount] = useState('');
  const [courier, setCourier] = useState('');
  const [shippingNotes, setShippingNotes] = useState('');
  const [conditionRating, setConditionRating] = useState(5);
  const [itemMatchesDescription, setItemMatchesDescription] = useState(true);
  const [evidenceTimeline, setEvidenceTimeline] = useState([]);
  const [disputeError, setDisputeError] = useState(null);
  const [shippingFiles, setShippingFiles] = useState([]);
  const [confirmDeliveryFiles, setConfirmDeliveryFiles] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastManualRefreshAt, setLastManualRefreshAt] = useState(null);
  const [buyerRefund, setBuyerRefund] = useState(null);

  const mpesaPollLastStatus = useRef('');

  /** @returns {Promise<{ ok: boolean, reason?: string }>} */
  const fetchTransaction = useCallback(async (userId, isAdminUser = false) => {
    try {
      const { data: txn, error } = await supabase
        .from('transactions')
        .select(`
          *,
          buyer:users!transactions_buyer_id_fkey (id, email, full_name),
          seller:users!transactions_seller_id_fkey (id, email, full_name)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      if (txn.buyer_id !== userId && txn.seller_id !== userId && !isAdminUser) {
        setError('Unauthorized');
        return { ok: false, reason: 'unauthorized' };
      }

      setError(null);
      setTransaction(txn);

      const { data: requestData } = await supabase
        .from('seller_transaction_requests')
        .select('*')
        .eq('transaction_id', id)
        .maybeSingle();

      setSellerRequest(requestData || null);

      const { data: { session } } = await supabase.auth.getSession();
      const evidenceResponse = await fetch(`/api/transactions/${id}/evidence`, {
        headers: {
          'Authorization': `Bearer ${session?.access_token || ''}`,
        },
      });
      if (evidenceResponse.ok) {
        const evidenceData = await evidenceResponse.json();
        setEvidenceTimeline(evidenceData.evidence || []);
      }

      return { ok: true };
    } catch (err) {
      console.error('Error fetching transaction:', err);
      setError('Transaction not found');
      return { ok: false, reason: 'error' };
    } finally {
      setLoading(false);
    }
  }, [id]);

  const handleRefresh = async () => {
    if (!user?.id || isRefreshing) return;
    setIsRefreshing(true);
    try {
      const result = await fetchTransaction(user.id);
      if (result?.ok) {
        setLastManualRefreshAt(new Date());
        toast.success('Latest data loaded');
      } else if (result?.reason === 'unauthorized') {
        toast.error('You do not have access to this transaction');
      } else {
        toast.error('Could not refresh. Try again in a moment.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!id || authLoading) return;
    if (!authUser) {
      router.push('/auth/login');
      setLoading(false);
      return;
    }

    setUser(authUser);
    const isAdminUser = profile?.role === 'admin';
    fetchTransaction(authUser.id, isAdminUser);
  }, [id, router, authUser, authLoading, fetchTransaction, profile?.role]);

  useEffect(() => {
    if (!transaction || typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    if (
      q.get('openDispute') === '1' &&
      ['escrow', 'delivered'].includes(transaction.status) &&
      transaction.status !== 'disputed'
    ) {
      setShowDisputeModal(true);
    }
  }, [transaction?.id, transaction?.status]);

  useEffect(() => {
    if (transaction?.status === 'payment_pending') {
      mpesaPollLastStatus.current = '';
    }
  }, [transaction?.id, transaction?.status]);

  useEffect(() => {
    if (!id || !user?.id || transaction?.status !== 'payment_pending') return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 100;

    const tick = async () => {
      if (cancelled || attempts++ > maxAttempts) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`/api/transactions/${id}/payment-status`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const j = await res.json();
        if (cancelled) return;

        const st = j.status || '';
        if (st === 'confirmed' && mpesaPollLastStatus.current !== 'confirmed') {
          toast.success(j.message || 'Payment confirmed');
        }
        if (
          ['cancelled', 'timeout', 'failed'].includes(st) &&
          !['cancelled', 'timeout', 'failed'].includes(mpesaPollLastStatus.current)
        ) {
          toast.info(j.message || 'Payment was not completed');
        }
        mpesaPollLastStatus.current = st;

        await fetchTransaction(user.id);
      } catch (e) {
        console.error('payment-status poll:', e);
      }
    };

    tick();
    const iv = setInterval(tick, 3500);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [id, user?.id, transaction?.status, fetchTransaction]);

  useEffect(() => {
    if (!transaction?.id || !user?.id || transaction.buyer_id !== user.id) {
      setBuyerRefund(null);
      return;
    }
    if (transaction.status !== 'refunded') {
      setBuyerRefund(null);
      return;
    }

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('refund_requests')
        .select('id, amount, phone, status, simulated, mpesa_transaction_id, completed_at, created_at')
        .eq('transaction_id', transaction.id)
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled && !error && data) setBuyerRefund(data);
    })();

    return () => {
      cancelled = true;
    };
  }, [transaction?.id, transaction?.status, transaction?.buyer_id, user?.id]);

  useEffect(() => {
    if (!id || transaction?.status !== 'payment_pending' || !user?.id) return;

    const ch = supabase
      .channel(`txn-pay-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'transactions',
          filter: `id=eq.${id}`,
        },
        () => {
          fetchTransaction(user.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, transaction?.status, user?.id, fetchTransaction]);

  /** Soft sync when the user returns to this tab (e.g. after acting on another device). */
  useEffect(() => {
    if (!user?.id || !id) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      fetchTransaction(user.id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [id, user?.id, fetchTransaction]);

  const initiatePayment = async () => {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/transactions/${id}/pay`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message);
        setShowPaymentModal(false);
        mpesaPollLastStatus.current = '';
        fetchTransaction(user.id);
      } else {
        const msg = result.error || 'Payment failed';
        if (result.code === 'MPESA_CALLBACK_NOT_CONFIGURED') {
          toast.error(msg, { duration: 12000 });
        } else {
          toast.error(msg);
        }
      }
    } catch (error) {
      console.error('Payment error:', error);
      toast.error('Failed to initiate payment');
    } finally {
      setActionLoading(false);
    }
  };

  const markAsShipped = async () => {
    if (!trackingNumber.trim() || !courier.trim()) {
      toast.error('Tracking number and courier are required.');
      return;
    }
    if (shippingFiles.length < 1) {
      toast.error('Add at least one photo showing dispatch proof (package, waybill, or handover).');
      return;
    }
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('tracking_number', trackingNumber.trim());
      formData.append('courier', courier.trim());
      if (shippingNotes.trim()) formData.append('notes', shippingNotes.trim());
      for (const file of shippingFiles) {
        formData.append('files', file);
      }

      const response = await fetch(`/api/transactions/${id}/ship`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message);
        setShowShippingModal(false);
        setTrackingNumber('');
        setCourier('');
        setShippingNotes('');
        setShippingFiles([]);
        fetchTransaction(user.id);
      } else {
        toast.error(result.error || 'Failed to mark as shipped');
      }
    } catch (error) {
      console.error('Shipping error:', error);
      toast.error('Failed to mark as shipped');
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDelivery = async () => {
    if (confirmDeliveryFiles.length < 1) {
      toast.error('Add at least one photo of the item received (or packaging) before confirming.');
      return;
    }
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('confirmation_comment', confirmationComment || '');
      formData.append('condition_rating', String(conditionRating));
      formData.append('item_matches_description', itemMatchesDescription ? 'true' : 'false');
      for (const file of confirmDeliveryFiles) {
        formData.append('files', file);
      }

      const response = await fetch(`/api/transactions/${id}/confirm-delivery`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const result = await response.json();
      
      if (result.success) {
        toast.success(result.message);
        setShowConfirmModal(false);
        setConfirmationComment('');
        setConfirmDeliveryFiles([]);
        fetchTransaction(user.id);
      } else {
        toast.error(result.error || 'Failed to confirm delivery');
      }
    } catch (error) {
      console.error('Confirmation error:', error);
      toast.error('Failed to confirm delivery');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRaiseDispute = async () => {
    setDisputeError(null);
    if (disputeFiles.length < 1) {
      setDisputeError('Please attach at least one image as evidence.');
      return;
    }
    const descChk = validateDisputeDescription(disputeDescription);
    if (!descChk.ok) {
      setDisputeError(descChk.error);
      return;
    }
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const formData = new FormData();
      formData.append('transaction_id', id);
      formData.append('reason', disputeReason);
      formData.append('description', disputeDescription);

      if (amountImpact.trim()) formData.append('amount_impact', amountImpact.trim());
      if (timelineNotes.trim()) formData.append('timeline_notes', timelineNotes.trim());

      formData.append('check_not_received', checkNotReceived ? 'true' : 'false');
      formData.append('check_condition_mismatch', checkConditionMismatch ? 'true' : 'false');
      formData.append('check_timeline_discrepancy', checkTimelineDiscrepancy ? 'true' : 'false');

      for (const file of disputeFiles) {
        formData.append('files', file);
      }

      const response = await fetch('/api/disputes', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const result = await response.json();
      
      if (response.ok && result.success) {
        setDisputeError(null);
        toast.success(result.message || 'Dispute created');
        setShowDisputeModal(false);
        setDisputeReason('');
        setDisputeDescription('');
        setDisputeFiles([]);
        setAmountImpact('');
        setCheckNotReceived(false);
        setCheckConditionMismatch(false);
        setCheckTimelineDiscrepancy(false);
        setTimelineNotes('');
        fetchTransaction(user.id);
      } else {
        const err = result.error || 'Failed to raise dispute';
        setDisputeError(err);
        toast.error(err);
      }
    } catch (error) {
      console.error('Dispute error:', error);
      setDisputeError('Failed to raise dispute');
      toast.error('Failed to raise dispute');
    } finally {
      setActionLoading(false);
    }
  };

  const submitSellerDecision = async (actionType) => {
    if (!transaction) return;
    setActionLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {};

      if (sellerMessage.trim()) {
        payload.seller_message = sellerMessage.trim();
      }
      if (actionType === 'request-changes' && proposedAmount.trim()) {
        payload.proposed_amount = proposedAmount.trim();
      }

      const response = await fetch(`/api/transactions/${id}/${actionType}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        toast.error(result.error || `Failed to ${actionType}`);
        return;
      }

      setSellerMessage('');
      setProposedAmount('');
      toast.success('Saved');
      fetchTransaction(user.id);
    } catch (err) {
      console.error(`${actionType} error:`, err);
      toast.error('Failed to submit seller decision');
    } finally {
      setActionLoading(false);
    }
  };

  const acceptSellerChanges = async () => {
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/transactions/${id}/accept-changes`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        toast.error(result.error || 'Failed to accept changes');
        return;
      }
      toast.success('Changes accepted');
      fetchTransaction(user.id);
    } finally {
      setActionLoading(false);
    }
  };

  const abandonCheckout = async () => {
    if (!user?.id) return;
    setActionLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`/api/transactions/${id}/abandon-checkout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        toast.error(result.error || 'Could not clear checkout');
        return;
      }
      toast.success(result.message || 'Checkout cleared');
      mpesaPollLastStatus.current = '';
      fetchTransaction(user.id);
    } catch (e) {
      console.error('abandon checkout:', e);
      toast.error('Failed to clear checkout');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      initiated: 'bg-gray-100 text-gray-800',
      pending_seller_approval: 'bg-purple-100 text-purple-800',
      seller_approved: 'bg-indigo-100 text-indigo-800',
      seller_rejected: 'bg-rose-100 text-rose-800',
      seller_change_requested: 'bg-orange-100 text-orange-800',
      payment_pending: 'bg-amber-100 text-amber-800',
      escrow: 'bg-blue-100 text-blue-800',
      delivered: 'bg-yellow-100 text-yellow-800',
      released: 'bg-green-100 text-green-800',
      disputed: 'bg-red-100 text-red-800',
      refunded: 'bg-orange-100 text-orange-800',
      cancelled: 'bg-gray-300 text-gray-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const flowStages = [
    'pending_seller_approval',
    'seller_approved',
    'payment_pending',
    'escrow',
    'delivered',
    'released',
  ];

  const currentStageIndex = Math.max(flowStages.indexOf(transaction?.status), 0);
  const progressPercent = transaction?.status === 'released'
    ? 100
    : Math.max(((currentStageIndex + 1) / flowStages.length) * 100, 10);

  const stageLabelMap = {
    pending_seller_approval: 'Awaiting Seller Approval',
    seller_approved: 'Seller Approved',
    payment_pending: 'Payment Pending',
    escrow: 'Funds in Escrow',
    delivered: 'Delivered',
    released: 'Completed',
  };

  const isBuyer = user && transaction && transaction.buyer_id === user.id;
  const isSeller = user && transaction && transaction.seller_id === user.id;
  const isAdminView = profile?.role === 'admin' && user && transaction && !isBuyer && !isSeller;
  const canRaiseDispute =
    transaction &&
    transaction.status !== 'disputed' &&
    ['escrow', 'delivered'].includes(transaction.status) &&
    (isBuyer || isSeller);
  const staleCheckoutForAbandon =
    transaction?.status === 'payment_pending' &&
    Boolean(transaction?.updated_at) &&
    Date.now() - new Date(transaction.updated_at).getTime() > 8 * 60 * 1000;
  const displayStageLabel =
    transaction?.status === 'delivered' && isBuyer
      ? 'Shipped — your confirmation releases funds (photos required)'
      : transaction?.status === 'delivered' && isSeller
        ? 'Shipped — waiting for buyer to confirm receipt'
        : stageLabelMap[transaction?.status] || transaction?.status;
  const itemDetailLines = (transaction?.description || '')
    .split(/\r?\n|•|;|\|/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading transaction...</p>
          <Link href="/dashboard" className="text-blue-600 hover:text-blue-700">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl shadow-lg p-6 md:p-8 mb-6 text-white">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-wide text-slate-300">Transaction ID</p>
            <p className="font-mono text-sm sm:text-lg break-all">{transaction.id.slice(0, 8)}…</p>
            {lastManualRefreshAt && (
              <p className="mt-1 text-xs text-slate-400">
                Last manual refresh: {lastManualRefreshAt.toLocaleString()}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Reload this transaction, seller request, and evidence without leaving the page"
              aria-busy={isRefreshing}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-500/80 bg-slate-800/90 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700/90 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.75}
                stroke="currentColor"
                className={`h-4 w-4 shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <span className={`px-4 py-2 rounded-full text-sm font-semibold ${getStatusColor(transaction.status)}`}>
              {transaction.status.toUpperCase()}
            </span>
          </div>
        </div>

        {isAdminView && (
          <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
            <p className="font-semibold text-base">Admin audit view (read-only)</p>
            <p className="text-sm mt-1">
              You are reviewing this transaction as an administrator. Payment and shipping actions are hidden.
            </p>
            <Link
              href={`/dashboard/admin/transactions/${transaction.id}`}
              className="inline-block mt-2 text-sm font-semibold text-amber-900 underline"
            >
              Open full audit record →
            </Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mb-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-300">Amount</p>
            <p className="text-3xl font-bold">KES {transaction.amount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-300">Created</p>
            <p className="text-slate-100">{new Date(transaction.created_at).toLocaleString()}</p>
          </div>
        </div>

        <div className="mb-5 rounded-xl border border-slate-600/80 bg-slate-800/70 p-4">
          <p className="text-xs uppercase tracking-wide text-sky-200 mb-2">Item Details</p>
          {itemDetailLines.length > 1 ? (
            <ul className="space-y-2 text-slate-100 text-sm md:text-base">
              {itemDetailLines.map((line, index) => (
                <li key={`${line}-${index}`} className="flex items-start gap-2">
                  <span className="mt-1 text-sky-300">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-100 text-sm md:text-base">
              {transaction.description || 'No item description provided yet.'}
            </p>
          )}
        </div>

        <div className="mb-5">
          <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-400 via-indigo-400 to-violet-400 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-slate-300">
            Current stage: {displayStageLabel}
          </p>
        </div>

        {isBuyer && transaction.status === 'delivered' && (
          <div className="mb-5 rounded-2xl border border-emerald-400/55 bg-gradient-to-br from-emerald-950/90 via-slate-900/95 to-slate-950 p-5 shadow-xl ring-1 ring-emerald-500/25">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300/95">Action needed</p>
            <h3 className="mt-1 text-xl font-bold text-white sm:text-2xl">Confirm you received the order</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-emerald-50/90">
              The seller has marked this shipment as sent. Escrow still holds your payment until you confirm with{' '}
              <span className="font-semibold text-white">photos of what you received</span>, a condition rating, and
              whether the item matches the listing.
            </p>
            {(transaction.tracking_number || transaction.courier) && (
              <p className="mt-3 text-sm text-emerald-100/85">
                {transaction.courier && <span className="font-medium text-white">{transaction.courier}</span>}
                {transaction.courier && transaction.tracking_number && ' · '}
                {transaction.tracking_number && (
                  <>
                    Tracking:{' '}
                    <span className="font-mono text-emerald-50">{transaction.tracking_number}</span>
                  </>
                )}
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setShowConfirmModal(true)}
                className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-emerald-950 shadow-md transition hover:bg-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              >
                Confirm delivery with evidence
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('transaction-actions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Jump to actions
              </button>
            </div>
            <p className="mt-4 text-xs text-emerald-200/70">
              Tip: If something is wrong, you can still raise a dispute from the Actions section after reviewing the
              evidence timeline below.
            </p>
          </div>
        )}

        {isSeller && transaction.status === 'delivered' && (
          <div className="mb-5 rounded-2xl border border-amber-400/45 bg-amber-950/35 p-4 ring-1 ring-amber-500/15">
            <p className="text-sm font-semibold text-amber-100">Awaiting buyer confirmation</p>
            <p className="mt-1 text-sm text-amber-50/85">
              The buyer needs to confirm receipt with photos before funds move to released. You will be notified when
              that happens.
            </p>
          </div>
        )}

        {/* Parties */}
        <div className="border-t border-slate-700 pt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-300 mb-1">Buyer</p>
              <p className="font-medium text-white">{transaction.buyer?.full_name || 'Loading...'}</p>
              <p className="text-sm text-slate-300">{transaction.buyer?.email || 'Loading...'}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-300 mb-1">Seller</p>
              <p className="font-medium text-white">{transaction.seller?.full_name || 'Loading...'}</p>
              <p className="text-sm text-slate-300">{transaction.seller?.email || 'Loading...'}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Payment Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Payment Method</p>
            <p className="text-gray-900 capitalize">{transaction.payment_method}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">M-Pesa Reference</p>
            <p className="text-gray-900 font-mono">{transaction.mpesa_receipt_number || transaction.mpesa_ref || 'N/A'}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Payment Confirmed</p>
            <p className="text-gray-900">
              {transaction.payment_confirmed_at 
                ? new Date(transaction.payment_confirmed_at).toLocaleString() 
                : 'Pending'}
            </p>
          </div>
        </div>
      </div>

      {isBuyer && transaction.status === 'refunded' && (
        <div className="mb-6 rounded-2xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-teal-50 p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wide text-emerald-800">Refund received</p>
              <p className="mt-2 text-lg font-semibold text-emerald-950">
                KES {Number(transaction.amount).toLocaleString()} was returned to your M-Pesa
                {buyerRefund?.phone ? ` (${buyerRefund.phone})` : ''}.
              </p>
              {buyerRefund?.mpesa_transaction_id && (
                <p className="mt-2 text-sm text-emerald-900">
                  Receipt:{' '}
                  <span className="font-mono font-semibold">{buyerRefund.mpesa_transaction_id}</span>
                  {buyerRefund.simulated ? ' · demo simulation' : ''}
                </p>
              )}
              {buyerRefund?.completed_at && (
                <p className="mt-1 text-xs text-emerald-800/80">
                  {new Date(buyerRefund.completed_at).toLocaleString()}
                </p>
              )}
              {!buyerRefund && (
                <p className="mt-2 text-sm text-emerald-900/80">
                  Refund details will appear once processing completes. Check Payments & refunds for the full receipt.
                </p>
              )}
            </div>
            <Link
              href={
                buyerRefund?.id
                  ? `/dashboard/buyer/payments?highlight=${buyerRefund.id}&tab=refunds`
                  : '/dashboard/buyer/payments?tab=refunds'
              }
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800"
            >
              View in Payments →
            </Link>
          </div>
        </div>
      )}

      {/* Delivery Information */}
      {(transaction.status === 'delivered' || transaction.status === 'released') && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Delivery Information</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Delivery Confirmed At</p>
              <p className="text-gray-900">
                {transaction.delivery_confirmed_at 
                  ? new Date(transaction.delivery_confirmed_at).toLocaleString() 
                  : 'Pending'}
              </p>
            </div>
            {transaction.auto_release_date && (
              <div>
                <p className="text-sm text-gray-600">Auto-Release Date</p>
                <p className="text-gray-900">
                  {new Date(transaction.auto_release_date).toLocaleString()}
                </p>
              </div>
            )}
          </div>
          {transaction.buyer_confirmation && (
            <div className="mt-4">
              <p className="text-sm text-gray-600">Buyer's Confirmation</p>
              <p className="text-gray-900">{transaction.buyer_confirmation}</p>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Evidence Timeline</h2>
        {evidenceTimeline.length === 0 ? (
          <p className="text-sm text-gray-600">No delivery evidence submitted yet.</p>
        ) : (
          <div className="space-y-3">
            {evidenceTimeline.map((evidence) => (
              <div
                key={evidence.id}
                className={`border rounded-lg p-4 ${
                  evidence.submission_type === 'seller_ship'
                    ? 'border-blue-200 bg-blue-50'
                    : evidence.submission_type === 'buyer_receive'
                    ? 'border-green-200 bg-green-50'
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <p className="text-sm font-semibold text-gray-900">
                    {evidence.submission_type === 'seller_ship'
                      ? 'Seller Shipping Evidence'
                      : evidence.submission_type === 'buyer_receive'
                      ? 'Buyer Delivery Confirmation'
                      : evidence.submission_type}
                  </p>
                  <p className="text-xs text-gray-600">
                    {new Date(evidence.submitted_at).toLocaleString()}
                  </p>
                </div>
                <p className="text-xs text-gray-700 mb-1">
                  Submitted by: {evidence.submitter?.full_name || evidence.submitter?.email || 'Unknown user'}
                </p>
                {evidence.tracking_number && (
                  <p className="text-sm text-gray-800">Tracking: {evidence.tracking_number}</p>
                )}
                {evidence.courier && (
                  <p className="text-sm text-gray-800">Courier: {evidence.courier}</p>
                )}
                {evidence.condition_rating && (
                  <p className="text-sm text-gray-800">Condition rating: {evidence.condition_rating}/5</p>
                )}
                {typeof evidence.item_matches_description === 'boolean' && (
                  <p className="text-sm text-gray-800">
                    Matches description: {evidence.item_matches_description ? 'Yes' : 'No'}
                  </p>
                )}
                {evidence.notes && (
                  <p className="text-sm text-gray-800 mt-1">{evidence.notes}</p>
                )}

                {evidence.photos && evidence.photos.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {evidence.photos.map((url, index) => (
                      <a
                        key={index}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                      >
                        <img
                          src={url}
                          alt={`Evidence photo ${index + 1}`}
                          className="w-full h-20 object-cover rounded-lg border border-gray-100 hover:opacity-90 transition"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div id="transaction-actions" className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Actions</h2>
        <p className="text-sm text-slate-500 mb-4">
          If the other party just acted, use <span className="font-medium text-slate-700">Refresh</span> at the top
          to sync this transaction without reloading the whole site.
        </p>

        {transaction.status === 'payment_pending' && (
          <div className="mb-4 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-950 text-sm space-y-2">
            <p className="font-semibold">M-Pesa checkout in progress</p>
            <p className="text-amber-900/90">
              {isBuyer
                ? 'Enter your PIN on your phone if prompted. This page checks Safaricom in the background and updates when funds hit escrow.'
                : 'Waiting for the buyer to complete payment on their phone.'}
            </p>
            {isBuyer && !staleCheckoutForAbandon && (
              <p className="text-xs text-amber-800/80">
                If the prompt failed because the callback URL was offline (for example ngrok not running), wait about 8 minutes after initiating pay, then you can clear the stuck checkout below.
              </p>
            )}
            {isBuyer && staleCheckoutForAbandon && (
              <button
                type="button"
                onClick={abandonCheckout}
                disabled={actionLoading}
                className="mt-1 text-sm font-medium text-amber-950 underline decoration-amber-700 hover:text-amber-900 disabled:opacity-50"
              >
                Clear stuck checkout and try paying again
              </button>
            )}
          </div>
        )}
        
        {isBuyer && (transaction.status === 'seller_approved' || transaction.status === 'initiated') && (
          <button
            onClick={() => setShowPaymentModal(true)}
            className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition font-medium mb-2"
          >
            Pay with M-Pesa
          </button>
        )}

        {isSeller && transaction.status === 'pending_seller_approval' && (
          <div className="space-y-3 mb-2">
            <p className="text-sm text-gray-700">
              Buyer is waiting for your approval before payment.
            </p>
            <textarea
              value={sellerMessage}
              onChange={(e) => setSellerMessage(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              rows="3"
              placeholder="Optional message for buyer (or required for change request)"
            />
            <input
              type="number"
              min="1"
              step="0.01"
              value={proposedAmount}
              onChange={(e) => setProposedAmount(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Optional proposed amount for change request"
            />
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => submitSellerDecision('approve')}
                disabled={actionLoading}
                className="w-full bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-medium"
              >
                Approve Transaction
              </button>
              <button
                onClick={() => submitSellerDecision('request-changes')}
                disabled={actionLoading || !sellerMessage.trim()}
                className="w-full bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 transition font-medium disabled:opacity-50"
              >
                Request Changes
              </button>
              <button
                onClick={() => submitSellerDecision('reject')}
                disabled={actionLoading}
                className="w-full bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition font-medium"
              >
                Reject Transaction
              </button>
            </div>
          </div>
        )}

        {isBuyer && transaction.status === 'pending_seller_approval' && (
          <p className="text-purple-700 text-sm mb-2">
            Waiting for seller approval before payment can be made.
          </p>
        )}

        {isBuyer && transaction.status === 'seller_change_requested' && (
          <div className="text-sm text-orange-700 mb-2 p-3 bg-orange-50 rounded-lg border border-orange-200">
            <p className="font-medium">Seller requested changes before approval.</p>
            {sellerRequest?.seller_message && <p className="mt-1">{sellerRequest.seller_message}</p>}
            {sellerRequest?.proposed_amount && (
              <p className="mt-1">Proposed amount: KES {Number(sellerRequest.proposed_amount).toLocaleString()}</p>
            )}
            <button
              onClick={acceptSellerChanges}
              disabled={actionLoading}
              className="mt-3 bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 transition font-medium disabled:opacity-50"
            >
              Accept Changes
            </button>
          </div>
        )}

        {isBuyer && transaction.status === 'delivered' && (
          <div className="mb-4 rounded-2xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-slate-50 p-5 shadow-sm ring-1 ring-emerald-100/80">
            <h3 className="text-lg font-bold text-emerald-950">Confirm receipt</h3>
            <p className="mt-1 text-sm text-emerald-900/80">
              Opens a short form: condition rating, description match, optional note, and at least one delivery photo
              (required before funds release).
            </p>
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
            >
              Open confirmation form
            </button>
          </div>
        )}

        {isSeller && transaction.status === 'escrow' && (
          <button
            onClick={() => setShowShippingModal(true)}
            className="w-full bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-medium mb-2"
          >
            Mark as Shipped
          </button>
        )}

        {isBuyer && transaction.status === 'delivered' && canRaiseDispute && (
          <div className="my-3 border-t border-slate-200 pt-3">
            <p className="text-center text-xs text-slate-500">or if there is a serious problem</p>
          </div>
        )}

        {canRaiseDispute && (
          <button
            onClick={() => setShowDisputeModal(true)}
            className="w-full bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 transition font-medium mb-2"
          >
            Raise Dispute
          </button>
        )}

        {transaction.status === 'released' && (
          <p className="text-green-600 text-center font-semibold">
            ✓ Transaction completed successfully
          </p>
        )}
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Confirm M-Pesa Payment</h3>
            <p className="text-slate-600 mb-5">
              You will receive an M-Pesa prompt on your phone to confirm payment of KES {transaction.amount.toLocaleString()}.
            </p>
            <div className="flex gap-2">
              <button
                onClick={initiatePayment}
                disabled={actionLoading}
                className="flex-1 bg-blue-600 text-white px-4 py-2.5 rounded-xl hover:bg-blue-700 transition font-semibold"
              >
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
              <button
                onClick={() => setShowPaymentModal(false)}
                className="flex-1 bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl hover:bg-slate-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shipping Modal */}
      {showShippingModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 max-w-md w-full">
            <h3 className="text-xl font-bold text-slate-900 mb-4">Submit Shipping Evidence</h3>
            <div className="mb-4">
              <label className="block text-base font-semibold text-gray-800 mb-2">
                Tracking Number *
              </label>
              <input
                type="text"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter tracking number"
              />
            </div>
            <div className="mb-4">
              <label className="block text-base font-semibold text-gray-800 mb-2">
                Courier *
              </label>
              <input
                type="text"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. G4S Kenya"
              />
            </div>
            <div className="mb-4">
              <label className="block text-base font-semibold text-gray-800 mb-2">
                Shipping Notes (optional)
              </label>
              <textarea
                value={shippingNotes}
                onChange={(e) => setShippingNotes(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows="3"
                placeholder="Packaging and dispatch details"
              />
            </div>
            <div className="mb-4">
              <EvidenceUploadPanel
                id="ship-evidence"
                files={shippingFiles}
                onChange={setShippingFiles}
                maxFiles={5}
                label="Dispatch photos *"
                helpText="Required with tracking: packaged item, courier slip, or label on the parcel. 1–5 images, JPEG/PNG/WebP, max 5MB each."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={markAsShipped}
                disabled={
                  actionLoading ||
                  !trackingNumber.trim() ||
                  !courier.trim() ||
                  shippingFiles.length < 1
                }
                className="flex-1 bg-green-600 text-white px-4 py-2.5 rounded-xl hover:bg-green-700 transition font-semibold"
              >
                {actionLoading ? 'Processing...' : 'Confirm Shipment'}
              </button>
              <button
                onClick={() => {
                  setShowShippingModal(false);
                  setShippingFiles([]);
                }}
                className="flex-1 bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl hover:bg-slate-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Confirm Delivery</h3>
            <p className="text-base text-slate-700 leading-relaxed mb-4">
              Confirming delivery releases escrow funds to the seller. Upload clear photos of what you received — this
              protects you if a dispute is opened later.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Condition Rating *
              </label>
              <select
                value={conditionRating}
                onChange={(e) => setConditionRating(Number(e.target.value))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value={5}>5 - Excellent</option>
                <option value={4}>4 - Good</option>
                <option value={3}>3 - Fair</option>
                <option value={2}>2 - Poor</option>
                <option value={1}>1 - Bad</option>
              </select>
            </div>
            <div className="mb-4 flex items-center gap-2">
              <input
                id="itemMatches"
                type="checkbox"
                checked={itemMatchesDescription}
                onChange={(e) => setItemMatchesDescription(e.target.checked)}
              />
              <label htmlFor="itemMatches" className="text-sm text-gray-700">
                Item matches the agreed description
              </label>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Confirmation Comment (optional)
              </label>
              <textarea
                value={confirmationComment}
                onChange={(e) => setConfirmationComment(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                rows="3"
                placeholder="Add any comments about the delivery"
              />
            </div>
            <div className="mb-4">
              <EvidenceUploadPanel
                id="confirm-delivery-evidence"
                files={confirmDeliveryFiles}
                onChange={setConfirmDeliveryFiles}
                maxFiles={5}
                label="Delivery photos *"
                helpText="Show the item you received and packaging. 1–5 images required before funds release."
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={confirmDelivery}
                disabled={actionLoading || confirmDeliveryFiles.length < 1}
                className="flex-1 bg-green-600 text-white px-4 py-2.5 rounded-xl hover:bg-green-700 transition font-semibold"
              >
                {actionLoading ? 'Processing...' : 'Confirm Delivery'}
              </button>
              <button
                onClick={() => {
                  setShowConfirmModal(false);
                  setConfirmDeliveryFiles([]);
                }}
                className="flex-1 bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl hover:bg-slate-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && transaction && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-slate-900 mb-2">Raise Dispute</h3>
            <p className="text-slate-600 mb-4 text-sm">
              Provide a clear description and images. Admins will review this together with the evidence already on this transaction.
            </p>
            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-800">
              <p className="font-semibold text-slate-900">Transaction summary</p>
              <p className="mt-1">
                <span className="text-slate-600">Amount:</span> KES {Number(transaction.amount).toLocaleString()}
              </p>
              <p>
                <span className="text-slate-600">Status:</span> {transaction.status}
              </p>
              <p>
                <span className="text-slate-600">Counterparty:</span>{' '}
                {isBuyer
                  ? transaction.seller?.full_name || transaction.seller?.email || 'Seller'
                  : transaction.buyer?.full_name || transaction.buyer?.email || 'Buyer'}
              </p>
              {transaction.tracking_number && (
                <p>
                  <span className="text-slate-600">Tracking:</span> {transaction.tracking_number}{' '}
                  {transaction.courier ? `(${transaction.courier})` : ''}
                </p>
              )}
              <p className="mt-2 text-slate-600">
                Evidence entries on file: {evidenceTimeline.length}. Your new images will be added to the case file.
              </p>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Reason *
              </label>
              <select
                required
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select a reason</option>
                <option value="item_not_received">Item not received</option>
                <option value="item_not_as_described">Item not as described</option>
                <option value="payment_issue">Payment issue</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="mb-4">
              <div className="flex justify-between items-baseline mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Description * (min {MIN_DESCRIPTION_LEN} characters)
                </label>
                <span
                  className={`text-xs font-medium ${
                    disputeDescription.trim().length >= MIN_DESCRIPTION_LEN
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                  }`}
                >
                  {disputeDescription.trim().length}/{MIN_DESCRIPTION_LEN}
                </span>
              </div>
              <textarea
                required
                value={disputeDescription}
                onChange={(e) => setDisputeDescription(e.target.value)}
                rows="5"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Explain what happened, dates, and what resolution you expect. Admins read this together with your photos."
              />
            </div>

            <div className="mb-4">
              <EvidenceUploadPanel
                id="dispute-evidence"
                files={disputeFiles}
                onChange={setDisputeFiles}
                maxFiles={3}
                label="Dispute evidence *"
                helpText="Attach 1–3 photos supporting your claim. Admins review these with the full transaction timeline."
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount Impact (optional)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={amountImpact}
                onChange={(e) => setAmountImpact(e.target.value)}
                placeholder="e.g. 2500"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">Structured Checklist (optional)</p>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={checkNotReceived}
                    onChange={(e) => setCheckNotReceived(e.target.checked)}
                  />
                  Not received
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={checkConditionMismatch}
                    onChange={(e) => setCheckConditionMismatch(e.target.checked)}
                  />
                  Condition mismatch / not as described
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={checkTimelineDiscrepancy}
                    onChange={(e) => setCheckTimelineDiscrepancy(e.target.checked)}
                  />
                  Timeline discrepancy
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Timeline Notes (optional)
              </label>
              <textarea
                value={timelineNotes}
                onChange={(e) => setTimelineNotes(e.target.value)}
                rows="2"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Key dates, communication milestones, or expected delivery window..."
              />
            </div>

            {disputeError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {disputeError}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleRaiseDispute}
                disabled={
                  actionLoading ||
                  !disputeReason ||
                  disputeDescription.trim().length < MIN_DESCRIPTION_LEN ||
                  disputeFiles.length < 1
                }
                className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-xl hover:bg-red-700 transition font-semibold disabled:opacity-50"
              >
                {actionLoading ? 'Submitting...' : 'Submit Dispute'}
              </button>
              <button
                onClick={() => {
                  setShowDisputeModal(false);
                  setDisputeReason('');
                  setDisputeDescription('');
                  setDisputeFiles([]);
                  setAmountImpact('');
                  setCheckNotReceived(false);
                  setCheckConditionMismatch(false);
                  setCheckTimelineDiscrepancy(false);
                  setTimelineNotes('');
                  setDisputeError(null);
                }}
                className="flex-1 bg-slate-200 text-slate-700 px-4 py-2.5 rounded-xl hover:bg-slate-300 transition font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
