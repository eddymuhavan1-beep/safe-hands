'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';

export default function BuyerDashboard() {
  const router = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    completed: 0,
    disputed: 0,
    refunded: 0,
    totalRefunded: 0,
    inEscrow: 0,
  });
  const [recentRefunds, setRecentRefunds] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState('initial');

  useEffect(() => {
    if (authLoading) return;

    const fetchTransactions = async () => {
      try {
        setLoadingStage('auth');
        if (!user) {
          router.push('/auth/login');
          return;
        }
        setLoadingStage('transactions');

        const { data } = await supabase
          .from('transactions')
          .select(`
            *,
            seller:seller_id(email, full_name, id),
            disputes(id, status)
          `)
          .eq('buyer_id', user.id)
          .order('created_at', { ascending: false });

        if (data) {
          setLoadingStage('processing');
          setTransactions(data);
          calculateStats(data);
        }

        const { data: { session } } = await supabase.auth.getSession();
        const payRes = await fetch('/api/buyer/payments', {
          headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        });
        if (payRes.ok) {
          const payBody = await payRes.json();
          if (payBody.summary) {
            setStats((prev) => ({
              ...prev,
              refunded: payBody.summary.refunded_transaction_count ?? 0,
              totalRefunded: payBody.summary.total_refunded ?? 0,
              inEscrow: payBody.summary.in_escrow ?? 0,
            }));
          }
          if (Array.isArray(payBody.refunds)) {
            setRecentRefunds(payBody.refunds.slice(0, 3));
          }
        }
      } catch (error) {
        console.error('Error fetching transactions:', error);
      } finally {
        setLoadingStage('complete');
        setTimeout(() => setLoading(false), 300);
      }
    };

    fetchTransactions();
  }, [user, authLoading, router]);

  const calculateStats = (transactionData) => {
    const newStats = {
      total: transactionData.length,
      active: transactionData.filter(t => ['initiated', 'pending_seller_approval', 'seller_approved', 'seller_change_requested', 'payment_pending', 'escrow', 'delivered'].includes(t.status)).length,
      completed: transactionData.filter(t => t.status === 'released').length,
      disputed: transactionData.filter(t => t.disputes && t.disputes.length > 0).length,
      refunded: transactionData.filter(t => t.status === 'refunded').length,
      totalRefunded: 0,
      inEscrow: 0,
    };
    setStats((prev) => ({ ...prev, ...newStats }));
  };

  const filteredTransactions = transactions.filter(transaction => {
    if (filter === 'all') return true;
    return transaction.status === filter;
  });

  const getStatusColor = (status) => {
    const colors = {
      initiated: 'bg-blue-100 text-blue-800',
      pending_seller_approval: 'bg-purple-100 text-purple-800',
      seller_approved: 'bg-indigo-100 text-indigo-800',
      seller_change_requested: 'bg-orange-100 text-orange-800',
      payment_pending: 'bg-amber-100 text-amber-800',
      escrow: 'bg-yellow-100 text-yellow-800',
      delivered: 'bg-purple-100 text-purple-800',
      released: 'bg-green-100 text-green-800',
      disputed: 'bg-red-100 text-red-800',
      refunded: 'bg-gray-100 text-gray-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getStatusIcon = (status) => {
    const icons = {
      initiated: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0" />
        </svg>
      ),
      escrow: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      delivered: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m8 4v10l-8 4m8-4v10a2 2 0 002 2H6a2 2 0 01-2-2V7m8 4v10a2 2 0 002 2H6a2 2 0 01-2-2V7m8 4v10a2 2 0 002 2H6a2 2 0 01-2-2V7" />
        </svg>
      ),
      released: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0" />
        </svg>
      ),
      disputed: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.432-2.5L6.6 15.5c-.562-.833-.562-1.667 0-2.5l6.85-3.5c1.07-.833 2.092.833 1.432 2.5z" />
        </svg>
      ),
    };
    return icons[status] || null;
  };

  const formatAmount = (amount) => {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency: 'KES',
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-KE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        {/* Loading Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <Spinner className="size-6 text-primary" />
            <h1 className="text-3xl font-bold text-gray-900">Loading Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 bg-primary rounded-full w-32 animate-pulse"></div>
            <span className="text-sm text-muted-foreground">
              {loadingStage === 'auth' && 'Authenticating...'}
              {loadingStage === 'transactions' && 'Fetching transactions...'}
              {loadingStage === 'processing' && 'Processing data...'}
              {loadingStage === 'complete' && 'Almost ready...'}
            </span>
          </div>
        </div>

        {/* Stats Cards Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-12" />
                </div>
                <Skeleton className="w-14 h-14 rounded-lg" />
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <div className="flex items-center gap-4">
                <Skeleton className="w-14 h-14 rounded-lg" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48" />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Transactions Table Skeleton */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-10 w-32" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <Skeleton className="h-4 w-20" />
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <Skeleton className="h-4 w-16" />
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <Skeleton className="h-4 w-12" />
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <Skeleton className="h-4 w-14" />
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <Skeleton className="h-4 w-10" />
                  </th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    <Skeleton className="h-4 w-16" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="border-b border-gray-200">
                    <td className="px-6 py-4">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-4 w-20" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-6 w-20 rounded-full" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-4 w-16" />
                    </td>
                    <td className="px-6 py-4">
                      <Skeleton className="h-4 w-24" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="space-y-8">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-600 text-white p-8 shadow-lg">
          <h1 className="text-3xl font-bold tracking-tight">Welcome Back, Buyer</h1>
        <p className="text-blue-100 mt-2 max-w-2xl">
          Track every escrow stage, confirm delivery with confidence, and resolve issues early if needed.
        </p>
        {profile?.role === 'buyer_seller' && (
          <div className="mt-5 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm text-white">
            <span className="font-semibold">You also sell on Safe Hands.</span>{' '}
            <Link href="/dashboard/seller" className="underline font-semibold hover:text-white/90">
              Open selling hub →
            </Link>
          </div>
        )}
      </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Transactions</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stats.total}</p>
              </div>
              <div className="w-14 h-14 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 5a2 2 0 012-2h6a2 2 0 012 2v2h1a2 2 0 012 2v3h-2V9H8v3H6V9a2 2 0 012-2h1V5zm0 0V3a1 1 0 011-1h6a1 1 0 011 1v2M6 9v10a2 2 0 002 2h8a2 2 0 002-2V9m-8 6h4" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Transactions</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stats.active}</p>
              </div>
              <div className="w-14 h-14 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-amber-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Released to seller</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stats.completed}</p>
              </div>
              <div className="w-14 h-14 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Refunded to you</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stats.refunded}</p>
                {stats.totalRefunded > 0 && (
                  <p className="text-xs text-emerald-700 font-medium mt-1">
                    {formatAmount(stats.totalRefunded)} via M-Pesa
                  </p>
                )}
              </div>
              <div className="w-14 h-14 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-emerald-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
              </div>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Open Disputes</p>
                <p className="text-3xl font-bold text-gray-900 mt-2">{stats.disputed}</p>
              </div>
              <div className="w-14 h-14 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-red-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <Link href="/dashboard/transactions/create" className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-300 transition-all duration-200 p-6 group">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-600 transition-colors duration-200">
                <svg className="w-7 h-7 text-blue-600 group-hover:text-white transition-colors duration-200" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors duration-200">Create Transaction</h3>
                <p className="text-sm text-gray-600 mt-1">Start a new escrow transaction</p>
              </div>
            </div>
          </Link>

          <Link href="/dashboard/marketplace" className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-blue-300 transition-all duration-200 p-6 group">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-600 transition-colors duration-200">
                <svg className="w-7 h-7 text-purple-600 group-hover:text-white transition-colors duration-200" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M15.5 1h-8C6.12 1 5 2.12 5 3.5v17C5 21.88 6.12 23 7.5 23h8c1.38 0 2.5-1.12 2.5-2.5v-17C18 2.12 16.88 1 15.5 1zm-4 21c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm4.5-4H7V4h9v14z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-purple-600 transition-colors duration-200">Browse Marketplace</h3>
                <p className="text-sm text-gray-600 mt-1">Discover items and sellers</p>
              </div>
            </div>
          </Link>

          <Link href="/dashboard/buyer/payments" className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-emerald-300 transition-all duration-200 p-6 group">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-emerald-100 rounded-lg flex items-center justify-center group-hover:bg-emerald-600 transition-colors duration-200">
                <svg className="w-7 h-7 text-emerald-600 group-hover:text-white transition-colors duration-200" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors duration-200">Payments & refunds</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {stats.inEscrow > 0
                    ? `${formatAmount(stats.inEscrow)} in escrow · view history`
                    : 'M-Pesa pay-ins and dispute refunds'}
                </p>
              </div>
            </div>
          </Link>
        </div>

        {recentRefunds.length > 0 && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-emerald-950">Recent refunds</h2>
                <p className="text-sm text-emerald-900/80">Dispute refunds sent back to your M-Pesa.</p>
              </div>
              <Link
                href="/dashboard/buyer/payments?tab=refunds"
                className="text-sm font-semibold text-emerald-800 hover:text-emerald-950"
              >
                View all →
              </Link>
            </div>
            <ul className="mt-4 space-y-3">
              {recentRefunds.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200/80 bg-white px-4 py-3"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{formatAmount(r.amount)} → {r.phone}</p>
                    <p className="text-xs text-slate-500">
                      {r.completed_at ? new Date(r.completed_at).toLocaleString() : new Date(r.created_at).toLocaleString()}
                      {r.mpesa_transaction_id ? ` · ${r.mpesa_transaction_id}` : ''}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/buyer/payments?highlight=${r.id}&tab=refunds`}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Receipt →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Transactions Table */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900">Recent Transactions</h2>
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700">Filter:</label>
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
                >
                  <option value="all">All Transactions</option>
                  <option value="initiated">Initiated</option>
                  <option value="pending_seller_approval">Awaiting Seller Approval</option>
                  <option value="seller_approved">Seller Approved</option>
                  <option value="seller_change_requested">Change Requested</option>
                  <option value="payment_pending">Payment Pending</option>
                  <option value="escrow">In Escrow</option>
                  <option value="delivered">Delivered</option>
                  <option value="released">Released to seller</option>
                  <option value="refunded">Refunded</option>
                  <option value="disputed">Disputed</option>
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Transaction</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Seller</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Amount</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Date</th>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="text-center py-12">
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012 2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                          </svg>
                        </div>
                        <p className="text-lg font-semibold text-gray-900">No transactions yet</p>
                        <p className="text-sm text-gray-600 mt-1 mb-4">
                          {filter === 'all' ? 'Start your first transaction to get began' : `No ${filter} transactions found`}
                        </p>
                        <Link 
                          href="/dashboard/transactions/create" 
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z" />
                          </svg>
                          Create Transaction
                        </Link>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredTransactions.map((transaction) => (
                    <tr key={transaction.id} className="border-b border-slate-200 hover:bg-slate-50 transition-colors duration-150">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-gray-700 font-semibold">
                            #{transaction.id.slice(0, 8)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-gray-900">{transaction.seller?.full_name || 'N/A'}</p>
                          <p className="text-sm text-gray-600">{transaction.seller?.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-bold text-gray-900">
                          {formatAmount(transaction.amount)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(transaction.status)}
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(transaction.status)}`}>
                            {transaction.status}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700 font-medium">
                        {formatDate(transaction.created_at)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          <Link
                            href={`/dashboard/transactions/${transaction.id}`}
                            className="text-blue-600 hover:text-blue-700 font-semibold text-sm transition-colors duration-150"
                          >
                            View Details →
                          </Link>
                          {transaction.status === 'refunded' && (
                            <Link
                              href="/dashboard/buyer/payments?tab=refunds"
                              className="text-emerald-600 hover:text-emerald-700 font-semibold text-sm transition-colors duration-150"
                            >
                              View refund →
                            </Link>
                          )}
                          {(transaction.status === 'escrow' ||
                            transaction.status === 'delivered') && (
                            <Link
                              href={`/dashboard/transactions/${transaction.id}?openDispute=1`}
                              className="text-red-600 hover:text-red-700 font-semibold text-sm transition-colors duration-150"
                            >
                              Raise dispute
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
}
