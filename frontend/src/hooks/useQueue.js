// src/hooks/useQueue.js
//
// Fetches the initial queue state and exposes seat/remove actions.
// Live updates come from useRealtime — this hook handles the initial
// fetch and the action functions only.

import { useState, useEffect, useCallback } from 'react';
import toast      from 'react-hot-toast';
import apiClient  from '../apiClient.js';

export function useQueue(outletId) {
  const [queue,   setQueue]   = useState([]);
  const [loading, setLoading] = useState(true);

  // ── Initial fetch ──────────────────────────────────────────────────────────
  const fetchQueue = useCallback(async () => {
    if (!outletId) return;
    try {
      setLoading(true);
      const { data } = await apiClient.get(`/api/queue/${outletId}`);
      setQueue(data.queue ?? []);
    } catch (err) {
      console.error('[useQueue] Fetch error:', err.message);
      toast.error('Failed to load queue.');
    } finally {
      setLoading(false);
    }
  }, [outletId]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // ── Realtime event handler ─────────────────────────────────────────────────
  // Called by useRealtime when Supabase pushes a DB change.
  const handleRealtimeEvent = useCallback((payload) => {
    const { eventType, new: newRow, old: oldRow } = payload;

    setQueue((prev) => {
      switch (eventType) {
        case 'INSERT':
          // Only add if status is waiting and not already in list
          if (newRow.status !== 'waiting') return prev;
          if (prev.some((e) => e.id === newRow.id)) return prev;
          return [...prev, newRow].sort((a, b) => a.position - b.position);

        case 'UPDATE':
          if (newRow.status !== 'waiting') {
            // Entry left the queue (seated / deleted / cancelled)
            return prev.filter((e) => e.id !== newRow.id);
          }
          // Position or other field updated — replace and re-sort
          return prev
            .map((e) => (e.id === newRow.id ? newRow : e))
            .sort((a, b) => a.position - b.position);

        case 'DELETE':
          return prev.filter((e) => e.id !== oldRow.id);

        default:
          return prev;
      }
    });
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  // Mark entry as seated (called after ConfirmModal confirms)
  const seat = useCallback(async (entryId) => {
    try {
      await apiClient.patch(`/api/queue/entry/${entryId}/seat`);
      toast.success('Customer marked as seated.');
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Failed to mark as seated.';
      toast.error(msg);
    }
    // No need to update local state — Supabase Realtime will push the UPDATE
  }, []);

  // Soft-delete entry (called after ConfirmModal confirms)
  const remove = useCallback(async (entryId) => {
    try {
      await apiClient.delete(`/api/queue/entry/${entryId}`);
      toast.success('Entry removed.');
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Failed to remove entry.';
      toast.error(msg);
    }
    // Realtime handles local state update
  }, []);

  return { queue, loading, seat, remove, handleRealtimeEvent, refetch: fetchQueue };
}