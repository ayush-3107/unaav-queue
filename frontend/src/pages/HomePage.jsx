// src/pages/HomePage.jsx
//
// Live queue management view.
// Shows all waiting customers, auto-updates via Supabase Realtime.
// Manager can mark entry (seat), delete, or manually add a walk-in.

import { useState }    from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast           from 'react-hot-toast';
import { useAuth }     from '../hooks/useAuth.js';
import { useQueue }    from '../hooks/useQueue.js';
import { useRealtime } from '../hooks/useRealtime.js';
import QueueRow        from '../components/QueueRow.jsx';
import ConfirmModal    from '../components/ConfirmModal.jsx';
import EmptyState      from '../components/EmptyState.jsx';
import apiClient       from '../apiClient.js';

// Validates an Indian mobile number: exactly 10 digits, starts with 6-9.
// Strips any non-digit characters (spaces, +91, dashes) before checking.
function isValidIndianPhone(value) {
  const digits = value.replace(/\D/g, '');
  // Allow numbers that include a leading 91 country code (12 digits total)
  const normalised = digits.length === 12 && digits.startsWith('91')
    ? digits.slice(2)
    : digits;
  return /^[6-9]\d{9}$/.test(normalised);
}

// ── Walk-in modal (inline — no extra file needed) ─────────────────────────────
function WalkInModal({ outletId, onClose, onAdded }) {
  const [name,      setName]      = useState('');
  const [phone,     setPhone]     = useState('');
  const [partySize, setPartySize] = useState('');
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (!phone.trim()) {
      toast.error('Phone number is required.');
      return;
    }

    if (!isValidIndianPhone(phone)) {
      toast.error('Please enter a valid 10-digit phone number.');
      return;
    }

    const pax = parseInt(partySize, 10);
    if (!pax || pax < 1 || pax > 20) {
      toast.error('Please enter a valid party size (1–20).');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post(`/api/queue/${outletId}/entry`, {
        phone:         phone.trim(),
        party_size:    pax,
        customer_name: name.trim() || null,
      });
      toast.success('Walk-in entry added.');
      onAdded();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Failed to add entry.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    // Backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-900">Add Walk-in</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">

          {/* Name — optional */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent
                         placeholder-gray-400"
            />
          </div>

          {/* Phone — required */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98100 12345"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent
                         placeholder-gray-400"
            />
          </div>

                    {/* Party size — required */}
                    <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
                Party Size <span className="text-red-500">*</span>
            </label>

            <input
                type="number"
                min="1"
                max="20"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
                placeholder="Enter party size"
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                        focus:outline-none focus:ring-2 focus:ring-blue-500
                        focus:border-transparent"
            />
            </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-lg border border-gray-300
                         text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700
                         text-white text-sm font-semibold transition-colors
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add to Queue'}
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}

// ── HomePage ──────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const { queue, loading, seat, remove, handleRealtimeEvent, refetch } = useQueue(auth.outlet_id);

  const [modal,       setModal]       = useState(null);   // confirm modal
  const [showWalkIn,  setShowWalkIn]  = useState(false);  // walk-in modal

  // Wire Supabase Realtime — updates queue state live
  useRealtime(auth.outlet_id, handleRealtimeEvent);

  function openSeatModal(entry)   { setModal({ type: 'seat',   entry }); }
  function openDeleteModal(entry) { setModal({ type: 'delete', entry }); }
  function openLogoutModal()      { setModal({ type: 'logout' }); }
  function closeModal()           { setModal(null); }

  async function handleConfirm() {
    if (!modal) return;
    if (modal.type === 'seat')   await seat(modal.entry.id);
    if (modal.type === 'delete') await remove(modal.entry.id);
    if (modal.type === 'logout') {
      logout();
      navigate('/login', { replace: true });
    }
    closeModal();
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-gray-900">{auth.outlet_name}</h1>
          <p className="text-xs text-gray-400">{auth.username}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/customers"
            className="text-sm text-brand font-medium hover:underline"
          >
            History
          </Link>
          <button
            onClick={openLogoutModal}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Logout
          </button>
        </div>
      </header>

      {/* ── Queue count bar + Walk-in button ──────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
            <span className="text-lg font-semibold text-gray-800">
                Walk-in ({queue.length})
            </span>
        </div>

        {/* Walk-in button */}
        <button
          onClick={() => setShowWalkIn(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg
                     bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold
                     transition-colors shadow-sm"
        >
          <span className="text-lg leading-none">+</span>
          Walk-in
        </button>
      </div>

      {/* ── Queue table ───────────────────────────────────────────────────── */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="space-y-2 mt-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-2">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500">Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-center">Pax</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500">Phone</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500">Arrived</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500">Wait</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-center">Entry</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-center">Del</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((entry) => (
                    <QueueRow
                      key={entry.id}
                      entry={entry}
                      onSeat={()   => openSeatModal(entry)}
                      onDelete={() => openDeleteModal(entry)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── Walk-in modal ─────────────────────────────────────────────────── */}
      {showWalkIn && (
        <WalkInModal
          outletId={auth.outlet_id}
          onClose={() => setShowWalkIn(false)}
          onAdded={refetch}
        />
      )}

      {/* ── Confirm modal ─────────────────────────────────────────────────── */}
      <ConfirmModal
        modal={modal}
        onConfirm={handleConfirm}
        onCancel={closeModal}
      />

    </div>
  );
}