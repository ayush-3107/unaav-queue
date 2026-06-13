// src/hooks/useRealtime.js
//
// Subscribes to Supabase Realtime on the queue_entries table,
// filtered to the manager's outlet_id.
// Calls handleRealtimeEvent from useQueue on every DB change.
// Unsubscribes automatically on component unmount.

import { useEffect } from 'react';
import { supabase }  from '../supabaseClient.js';

export function useRealtime(outletId, handleRealtimeEvent) {
  useEffect(() => {
    if (!outletId) return;

    const channel = supabase
      .channel(`queue-outlet-${outletId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',           // INSERT, UPDATE, DELETE
          schema: 'public',
          table:  'queue_entries',
          filter: `outlet_id=eq.${outletId}`,
        },
        handleRealtimeEvent
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[Realtime] Subscribed to queue for outlet: ${outletId}`);
        }
        if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] Channel error — live updates may be delayed.');
        }
      });

    // Cleanup: unsubscribe when component unmounts or outletId changes
    return () => {
      supabase.removeChannel(channel);
    };
  }, [outletId, handleRealtimeEvent]);
}