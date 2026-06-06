'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/context/AuthContext';

const statusColors = {
  initiated: 'bg-blue-100 text-blue-700',
  escrow: 'bg-yellow-100 text-yellow-700',
  delivered: 'bg-orange-100 text-orange-700',
  released: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  disputed: 'bg-purple-100 text-purple-700',
};

export default function AdminTransactionsPage() {
  const router = useRouter();
  const { profile, loading: authLoading } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedTx, setSelectedTx] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);

  // Check admin access and fetch transactions
  useEffect(() => {
    if (authLoading) return;
    
    if (!profile || profile.role !== 'admin') {
      router.push('/dashboard');
      setLoading(false);
      return;
    }
    
    fetchTransactions();
  }, [profile, authLoading, router]);

  const fetchTransactions = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('transactions')
        .select(`
          *,
          buyer:buyer_id(full_name, email, id),
          seller:seller_id(full_name, email, id)
        `)
        .order('created_at', { ascending: false });

      if (err) throw err;
      setTransactions(data || []);
    } catch (err) {
      console.error('[v0] Error fetching transactions:', err);
      setError('Failed to load transactions');
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = transactions.filter(tx => {
    const matchesSearch = tx.item_description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         tx.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         tx.buyer?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         tx.seller?.full_name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || tx.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const openModal = (transaction) => {
    setSelectedTx(transaction);
    setShowModal(true);
    setActionMessage(null);
    setNewStatus('');
    setNotes('');
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedTx(null);
    setNewStatus('');
    setNotes('');
    setActionMessage(null);
  };

  const handleUpdateStatus = async () => {
    if (!selectedTx || !newStatus) {
      setActionMessage({ type: 'error', text: 'Please select a new status' });
      return;
    }

    setActionLoading(true);
    try {
      const { error: err } = await supabase
        .from('transactions')
        .update({
          status: newStatus,
          admin_override_notes: notes,
          admin_override_at: new Date().toISOString(),
        })
        .eq('id', selectedTx.id);

      if (err) throw err;

      setTransactions(transactions.map(tx =>
        tx.id === selectedTx.id
          ? { ...tx, status: newStatus, admin_override_notes: notes }
          : tx
      ));

      setActionMessage({
        type: 'success',
        text: 'Transaction status updated successfully'
      });

      setTimeout(closeModal, 1500);
    } catch (err) {
      console.error('[v0] Error updating transaction:', err);
      setActionMessage({ type: 'error', text: 'Failed to update transaction' });
    } finally {
      setActionLoading(false);
    }
  };

  const renderModal = () => {
    if (!showModal || !selectedTx) return null;

    const statusOptions = ['initiated', 'escrow', 'delivered', 'released', 'cancelled', 'disputed'];

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
          <div className="p-6 border-b border-gray-200 sticky top-0 bg-white">
            <h3 className="text-lg font-bold text-gray-900">Override Transaction Status</h3>
          </div>

          <div className="p-6 space-y-6">
            {/* Transaction Info */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold">Transaction ID</p>
                  <p className="font-mono text-sm font-semibold text-gray-900">#{selectedTx.id.slice(0, 8)}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[selectedTx.status]}`}>
                  {selectedTx.status.replace('_', ' ')}
                </span>
              </div>

              <div>
                <p className="text-xs text-gray-600 uppercase font-semibold">Item</p>
                <p className="text-sm text-gray-900">{selectedTx.item_description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold">Amount</p>
                  <p className="text-lg font-bold text-gray-900">KES {selectedTx.amount?.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold">Created</p>
                  <p className="text-sm text-gray-900">{new Date(selectedTx.created_at).toLocaleDateString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-200">
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold mb-1">Buyer</p>
                  <p className="text-sm font-semibold text-gray-900">{selectedTx.buyer?.full_name}</p>
                  <p className="text-xs text-gray-600">{selectedTx.buyer?.email}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 uppercase font-semibold mb-1">Seller</p>
                  <p className="text-sm font-semibold text-gray-900">{selectedTx.seller?.full_name}</p>
                  <p className="text-xs text-gray-600">{selectedTx.seller?.email}</p>
                </div>
              </div>
            </div>

            {/* Status Update Form */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">New Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                >
                  <option value="">-- Select Status --</option>
                  {statusOptions.filter(s => s !== selectedTx.status).map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ')}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Admin Notes (Override Reason)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Explain why you're overriding this transaction status..."
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
                onClick={handleUpdateStatus}
                disabled={actionLoading || !newStatus}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium disabled:opacity-50"
              >
                {actionLoading ? 'Processing...' : 'Update Status'}
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
          <p className="text-gray-600 font-medium">Loading transactions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Manage Transactions</h1>
        <p className="text-gray-600 mt-1">View and override transaction statuses</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
          <p className="text-red-700 font-medium text-sm">{error}</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-6">
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-semibold text-gray-900 mb-2">Search</label>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search by ID, buyer, seller, or item..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            >
              <option value="all">All Status</option>
              <option value="initiated">Initiated</option>
              <option value="escrow">Escrow</option>
              <option value="delivered">Delivered</option>
              <option value="released">Released</option>
              <option value="cancelled">Cancelled</option>
              <option value="disputed">Disputed</option>
            </select>
          </div>
        </div>

        {/* Transactions Table */}
        <div className="overflow-x-auto">
          {filteredTransactions.length === 0 ? (
            <div className="py-12 text-center">
              <svg className="w-12 h-12 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-lg font-semibold text-gray-900">No transactions found</p>
              <p className="text-sm text-gray-600 mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">ID</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">Item</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">Buyer</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">Seller</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono font-semibold text-gray-900">#{tx.id.slice(0, 8)}</td>
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{tx.item_description}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{tx.buyer?.full_name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{tx.seller?.full_name}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-gray-900">KES {tx.amount?.toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${statusColors[tx.status]}`}>
                        {tx.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/dashboard/admin/transactions/${tx.id}`}
                          className="px-3 py-1.5 bg-slate-100 text-slate-800 rounded-lg hover:bg-slate-200 transition font-medium text-xs"
                        >
                          Audit
                        </Link>
                        <button
                          onClick={() => openModal(tx)}
                          className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition font-medium text-xs"
                        >
                          Override
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Stats */}
        <div className="pt-4 border-t border-gray-200 grid grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600">{filteredTransactions.filter(t => t.status === 'escrow').length}</p>
            <p className="text-sm text-gray-600">In Escrow</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{filteredTransactions.filter(t => t.status === 'released').length}</p>
            <p className="text-sm text-gray-600">Released</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-purple-600">{filteredTransactions.filter(t => t.status === 'disputed').length}</p>
            <p className="text-sm text-gray-600">Disputed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">{filteredTransactions.length}</p>
            <p className="text-sm text-gray-600">Shown</p>
          </div>
        </div>
      </div>

      {renderModal()}
    </div>
  );
}
