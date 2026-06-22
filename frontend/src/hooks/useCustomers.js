// src/hooks/useCustomers.js
//
// Fetches the historical customer log with filters.
// Refetches automatically when any filter changes (debounced for search).
// Exposes exportCSV() to trigger a CSV file download.
// CSV now includes review columns.

import { useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import Papa       from 'papaparse';
import toast      from 'react-hot-toast';
import apiClient  from '../apiClient.js';

export function useCustomers(outletId) {
  const today = format(new Date(), 'yyyy-MM-dd');

  // ── Filter state ───────────────────────────────────────────────────────────
  const [date,   setDate]   = useState(today);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page,   setPage]   = useState(1);

  // ── Result state ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState([]);
  const [total,   setTotal]   = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  // Debounce ref for search input
  const searchDebounceRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(searchDebounceRef.current);
  }, [search]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [date, status]);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchCustomers = useCallback(async () => {
    if (!outletId) return;
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/api/customers/${outletId}`, {
        params: {
          date:   date,
          status: status !== 'all' ? status : undefined,
          search: debouncedSearch || undefined,
          page,
          limit:  50,
        },
      });
      setEntries(data.entries ?? []);
      setTotal(data.total    ?? 0);
      setSummary(data.summary ?? null);
    } catch (err) {
      console.error('[useCustomers] Fetch error:', err.message);
      toast.error('Failed to load customer history.');
    } finally {
      setLoading(false);
    }
  }, [outletId, date, status, debouncedSearch, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // ── CSV Export ─────────────────────────────────────────────────────────────
  const exportCSV = useCallback(async () => {
    try {
      toast.loading('Preparing export...', { id: 'csv-export' });

      // Fetch all entries for the current date/status/search (no pagination)
      const { data } = await apiClient.get(`/api/customers/${outletId}`, {
        params: {
          date:   date,
          status: status !== 'all' ? status : undefined,
          search: debouncedSearch || undefined,
          limit:  200,
          page:   1,
        },
      });

      const rows = (data.entries ?? []).map((e, i) => ({
        'S.No':                      i + 1,
        'Name':                      e.customer_name ?? '',
        'Party Size':                e.party_size,
        'Phone':                     e.phone,
        'Status':                    e.status,
        'Table Seating':             'Walk-in',
        'Initial Queue Position':    e.initial_position ?? '',
        'Initial Waiting Time (mins)': e.estimated_wait_mins ?? '',
        'Total Waiting Time (mins)': e.action_at && e.arrived_at
          ? Math.round((new Date(e.action_at) - new Date(e.arrived_at)) / 60000)
          : '',
        'Arrived At': e.arrived_at
          ? format(new Date(e.arrived_at), 'dd MMM, hh:mm a')
          : '',
        'Entry / Action Time': e.action_at
          ? format(new Date(e.action_at), 'dd MMM, hh:mm a')
          : '',
        // ── Review columns ──────────────────────────────────────────────
        'Rating':          e.overall_rating  ?? '',
        'Food Rating':     e.food_rating      ?? '',
        'Service Rating':  e.service_rating   ?? '',
        'Ambiance Rating': e.ambiance_rating  ?? '',
        'User Feedback':   e.user_feedback    ?? '',
      }));

      const csv      = Papa.unparse(rows);
      const blob     = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url      = URL.createObjectURL(blob);
      const link     = document.createElement('a');
      link.href      = url;
      link.download  = `unaav-queue-${date}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('Export downloaded.', { id: 'csv-export' });
    } catch (err) {
      console.error('[useCustomers] Export error:', err.message);
      toast.error('Export failed.', { id: 'csv-export' });
    }
  }, [outletId, date, status, debouncedSearch]);

  return {
    // Data
    entries, total, summary, loading,
    // Filters
    date, setDate,
    status, setStatus,
    search, setSearch,
    page, setPage,
    // Actions
    exportCSV,
    refetch: fetchCustomers,
  };
}