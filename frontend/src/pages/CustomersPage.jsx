// src/pages/CustomersPage.jsx
//
// Historical log of all queue entries for the outlet.
// Filterable by date, status, rating, and search.
// Supports CSV export.
// Now includes review columns: Overall Rating, Food, Service, Ambiance, Feedback.

import { useState }        from 'react';
import { Link }            from 'react-router-dom';
import { format }          from 'date-fns';
import { useAuth }         from '../hooks/useAuth.js';
import { useCustomers }    from '../hooks/useCustomers.js';
import StatusBadge         from '../components/StatusBadge.jsx';

const LIMIT = 50;

// Renders rating as "3/5" or "—" if not rated
function RatingCell({ value }) {
  if (value == null) return <span className="text-gray-300">—</span>;
  return (
    <span className="text-sm text-gray-700 font-medium">
      {value}/5
    </span>
  );
}

export default function CustomersPage() {
  const { auth }   = useAuth();
  const {
    entries, total, summary, loading,
    date, setDate,
    status, setStatus,
    search, setSearch,
    page, setPage,
    exportCSV,
  } = useCustomers(auth.outlet_id);

  // Rating filter — client-side filter on fetched entries
  const [ratingFilter, setRatingFilter] = useState('all');

  // Apply rating filter on top of server-filtered entries
  const filteredEntries = entries.filter((e) => {
    if (ratingFilter === 'all')      return true;
    if (ratingFilter === '5')        return e.overall_rating === 5;
    if (ratingFilter === '4')        return e.overall_rating === 4;
    if (ratingFilter === '3orless')  return e.overall_rating != null && e.overall_rating <= 3;
    if (ratingFilter === 'unrated')  return e.overall_rating == null;
    return true;
  });

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/home" className="text-brand text-sm font-medium hover:underline">
            ← Queue
          </Link>
          <h1 className="text-base font-bold text-gray-900">Customer History</h1>
        </div>
        <button
          onClick={exportCSV}
          className="text-sm font-medium text-brand border border-brand
                     px-3 py-1.5 rounded-lg hover:bg-brand-light transition-colors"
        >
          Export CSV
        </button>
      </header>

      {/* ── Summary bar ─────────────────────────────────────────────────────── */}
      {summary && (
        <div className="px-4 pt-3">
          <p className="text-xs text-gray-500">
            Total {summary.total_entries} entries, {summary.total_pax} pax
            &nbsp;·&nbsp; Seated: {summary.seated_count}
            &nbsp;·&nbsp; Cancelled: {summary.cancelled_count}
            &nbsp;·&nbsp; Deleted: {summary.deleted_count}
            &nbsp;·&nbsp; Waiting: {summary.waiting_count}
          </p>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
        {/* Date picker */}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-brand"
        />

        {/* Status filter */}
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-brand bg-white"
        >
          <option value="all">All Status</option>
          <option value="waiting">Waiting</option>
          <option value="seated">Seated</option>
          <option value="cancelled">Cancelled</option>
          <option value="deleted">Deleted</option>
        </select>

        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or phone..."
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-brand
                     placeholder-gray-400 min-w-[200px]"
        />

        {/* Rating filter */}
        <select
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-brand bg-white"
        >
          <option value="all">All Ratings</option>
          <option value="5">5/5</option>
          <option value="4">4/5</option>
          <option value="3orless">3/5 or less</option>
          <option value="unrated">Not Rated</option>
        </select>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="px-4 pb-8">
        {loading ? (
          <div className="space-y-2 mt-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-16 text-gray-400 text-sm">
            No entries found for the selected filters.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-2">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[1400px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {[
                      'S.No', 'Name', 'Pax', 'Phone', 'Status',
                      'Arrived At', 'Init. Pos', 'Est. Wait',
                      'Total Wait', 'Action Time',
                      'Rating', 'Food', 'Service', 'Ambiance', 'Feedback',
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry, index) => {
                    const totalWait = entry.action_at && entry.arrived_at
                      ? Math.round(
                          (new Date(entry.action_at) - new Date(entry.arrived_at)) / 60000
                        )
                      : null;

                    const actionLabel =
                      entry.status === 'seated'    ? 'Entry Time'  :
                      entry.status === 'deleted'   ? 'Delete Time' :
                      entry.status === 'cancelled' ? 'Cancel Time' : '—';

                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {(page - 1) * LIMIT + index + 1}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {entry.customer_name ?? `User …${entry.phone.slice(-4)}`}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 text-center">
                          {entry.party_size}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {entry.phone}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={entry.status} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {entry.arrived_at
                            ? format(new Date(entry.arrived_at), 'dd MMM, hh:mm a')
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 text-center">
                          {entry.initial_position ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 text-center">
                          {entry.estimated_wait_mins != null
                            ? `${entry.estimated_wait_mins} min`
                            : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 text-center">
                          {totalWait != null ? `${totalWait} min` : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {entry.action_at ? (
                            <span title={actionLabel}>
                              {format(new Date(entry.action_at), 'dd MMM, hh:mm a')}
                            </span>
                          ) : '—'}
                        </td>

                        {/* ── Review columns ──────────────────────────────── */}
                        <td className="px-4 py-3">
                          <RatingCell value={entry.overall_rating} />
                        </td>
                        <td className="px-4 py-3">
                          <RatingCell value={entry.food_rating} />
                        </td>
                        <td className="px-4 py-3">
                          <RatingCell value={entry.service_rating} />
                        </td>
                        <td className="px-4 py-3">
                          <RatingCell value={entry.ambiance_rating} />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-[220px]">
                          {entry.user_feedback ? (
                            <span title={entry.user_feedback} className="line-clamp-2">
                              {entry.user_feedback}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-gray-500">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                           disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg
                           disabled:opacity-40 hover:bg-gray-50 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}