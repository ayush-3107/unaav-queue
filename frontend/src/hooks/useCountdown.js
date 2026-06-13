// src/hooks/useCountdown.js
//
// Computes a live wait-time display string for a single queue row.
// Counts DOWN from estimated_wait_mins using elapsed time since arrived_at.
// Updates every 60 seconds.
//
// Returns a display string like:
//   '~32 mins remaining'  — still waiting
//   'Any moment now'      — estimate has passed but still waiting
//   ''                    — no estimate available

import { useState, useEffect } from 'react';

export function useCountdown(arrivedAt, estimatedWaitMins) {
  const [display, setDisplay] = useState('');

  useEffect(() => {
    if (!arrivedAt || estimatedWaitMins == null) {
      setDisplay('');
      return;
    }

    function compute() {
      const arrivalMs  = new Date(arrivedAt).getTime();
      const elapsedMin = (Date.now() - arrivalMs) / 60000;
      const remaining  = Math.round(estimatedWaitMins - elapsedMin);

      if (remaining <= 0) {
        setDisplay('Any moment now');
      } else if (remaining === 1) {
        setDisplay('~1 min remaining');
      } else {
        setDisplay(`~${remaining} mins remaining`);
      }
    }

    compute(); // Run immediately

    const interval = setInterval(compute, 60 * 1000); // Update every minute
    return () => clearInterval(interval);
  }, [arrivedAt, estimatedWaitMins]);

  return display;
}