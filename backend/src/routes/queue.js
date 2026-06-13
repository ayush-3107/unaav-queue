// // src/routes/queue.js
// //
// // All queue management endpoints. All routes require JWT auth.
// //
// // Routes:
// //   GET    /api/queue/:outletId          — fetch live queue (waiting entries)
// //   POST   /api/queue/:outletId/entry    — manually add walk-in from dashboard
// //   PATCH  /api/queue/entry/:id/seat     — mark customer as seated
// //   DELETE /api/queue/entry/:id          — soft-delete entry

// import { Router }     from 'express';
// import authenticate   from '../middleware/authenticate.js';
// import QueueEngine    from '../services/QueueEngine.js';
// import Notifier       from '../services/Notifier.js';
// import ConfigLoader   from '../services/ConfigLoader.js';
// import supabase       from '../utils/supabaseClient.js';

// const router = Router();

// // All queue routes require a valid JWT
// router.use(authenticate);

// // ── Guard helper ──────────────────────────────────────────────────────────────
// // Ensures the manager's outlet_id (from JWT) matches the requested outletId.
// // Prevents cross-outlet data access.
// function assertOutletAccess(req, res, outletId) {
//   if (req.user.outlet_id !== outletId) {
//     res.status(403).json({ error: 'Access denied to this outlet.' });
//     return false;
//   }
//   return true;
// }

// // ── GET /api/queue/:outletId ──────────────────────────────────────────────────
// // Returns all waiting entries ordered by position ASC.
// // Used by the Home tab on initial load and manual refresh.
// // Supabase Realtime handles live updates — this is just the initial fetch.
// router.get('/:outletId', async (req, res) => {
//   const { outletId } = req.params;

//   if (!assertOutletAccess(req, res, outletId)) return;

//   try {
//     const queue = await QueueEngine.getQueueSnapshot(outletId);
//     return res.status(200).json({ queue });
//   } catch (err) {
//     console.error('[Queue GET] Error:', err.message);
//     return res.status(500).json({ error: 'Failed to fetch queue.' });
//   }
// });

// // ── POST /api/queue/:outletId/entry ───────────────────────────────────────────
// // Manually adds a walk-in entry from the manager dashboard.
// // Used when a customer walks in without using WhatsApp.
// router.post('/:outletId/entry', async (req, res) => {
//   const { outletId } = req.params;

//   if (!assertOutletAccess(req, res, outletId)) return;

//   const { phone, party_size, customer_name } = req.body ?? {};

//   if (!phone || !party_size) {
//     return res.status(400).json({ error: 'phone and party_size are required.' });
//   }

//   if (!Number.isInteger(party_size) || party_size < 1) {
//     return res.status(400).json({ error: 'party_size must be a positive integer.' });
//   }

//   try {
//     // Fetch outlet config for wait time calculation
//     const { data: outletRow } = await supabase
//       .from('outlets')
//       .select('slug')
//       .eq('id', outletId)
//       .single();

//     const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);
//     if (!outlet) {
//       return res.status(500).json({ error: 'Outlet configuration not found.' });
//     }

//     // Create entry
//     const entry = await QueueEngine.createEntry({
//       outlet_id:     outletId,
//       phone,
//       party_size,
//       customer_name: customer_name ?? null,
//     });

//     // Recalculate positions — assigns position to the new entry
//     await QueueEngine.recalculatePositions(outletId);

//     // Re-fetch to get assigned position
//     const updatedEntry = await QueueEngine.getEntryById(entry.id);
//     const position     = updatedEntry.position;

//     // Calculate and store wait time + initial_position
//     const estimatedWait = QueueEngine.calculateWaitTime(outlet, position);
//     await QueueEngine.updateEntryFields(entry.id, {
//       initial_position:    position,
//       estimated_wait_mins: estimatedWait,
//     });

//     // Create a wa_session for this entry so notifications work
//     await supabase
//       .from('wa_sessions')
//       .upsert({
//         phone,
//         outlet_id:           outletId,
//         state:               'in_queue',
//         queue_entry_id:      entry.id,
//         notifications_sent:  0,
//         updated_at:          new Date().toISOString(),
//       }, { onConflict: 'phone' });

//     // Fetch final entry state to return
//     const finalEntry = await QueueEngine.getEntryById(entry.id);

//     console.log(
//       `[Queue POST] Manual entry added: ${phone}, ` +
//       `party=${party_size}, position=${position}, outlet=${outlet.name}`
//     );

//     return res.status(201).json({ entry: finalEntry });
//   } catch (err) {
//     console.error('[Queue POST] Error:', err.message);
//     return res.status(500).json({ error: 'Failed to create queue entry.' });
//   }
// });

// // ── PATCH /api/queue/entry/:id/seat ──────────────────────────────────────────
// // Marks a customer as seated (manager taps → and confirms).
// // Triggers: position recalculation + table-confirmed WA message.
// router.patch('/entry/:id/seat', async (req, res) => {
//   const { id } = req.params;

//   try {
//     // Fetch entry to verify it exists and belongs to manager's outlet
//     const entry = await QueueEngine.getEntryById(id);

//     if (!entry) {
//       return res.status(404).json({ error: 'Queue entry not found.' });
//     }

//     if (!assertOutletAccess(req, res, entry.outlet_id)) return;

//     if (entry.status !== 'waiting') {
//       return res.status(400).json({
//         error: `Entry cannot be seated — current status is '${entry.status}'.`,
//       });
//     }

//     // Fetch outlet config for WA message
//     const { data: outletRow } = await supabase
//       .from('outlets')
//       .select('slug')
//       .eq('id', entry.outlet_id)
//       .single();

//     const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);

//     // Mark as seated
//     await QueueEngine.updateEntryStatus(id, 'seated');

//     // Update wa_session state → done
//     await supabase
//       .from('wa_sessions')
//       .update({ state: 'done', updated_at: new Date().toISOString() })
//       .eq('queue_entry_id', id);

//     // Recalculate positions for remaining customers
//     await QueueEngine.recalculatePositions(entry.outlet_id);

//     // Send table-confirmed WA message to the seated customer
//     if (outlet) {
//       await Notifier.sendEventMessage(entry, outlet, 'seat');
//     }

//     // Trigger notifications for remaining customers whose position improved
//     const remainingEntries = await QueueEngine.getQueueSnapshot(entry.outlet_id);
//     for (const remaining of remainingEntries) {
//       await Notifier.checkAndNotify(remaining.id);
//     }

//     const updatedEntry = await QueueEngine.getEntryById(id);

//     console.log(`[Queue PATCH] Entry seated: ${id} (${entry.phone})`);

//     return res.status(200).json({ entry: updatedEntry });
//   } catch (err) {
//     console.error('[Queue PATCH seat] Error:', err.message);
//     return res.status(500).json({ error: 'Failed to seat entry.' });
//   }
// });

// // ── DELETE /api/queue/entry/:id ───────────────────────────────────────────────
// // Soft-deletes an entry (manager taps 🗑 and confirms).
// // No WA message sent on manager-initiated delete.
// router.delete('/entry/:id', async (req, res) => {
//   const { id } = req.params;

//   try {
//     const entry = await QueueEngine.getEntryById(id);

//     if (!entry) {
//       return res.status(404).json({ error: 'Queue entry not found.' });
//     }

//     if (!assertOutletAccess(req, res, entry.outlet_id)) return;

//     if (entry.status !== 'waiting') {
//       return res.status(400).json({
//         error: `Entry cannot be deleted — current status is '${entry.status}'.`,
//       });
//     }

//     // Soft delete — status → deleted, action_at = now
//     await QueueEngine.updateEntryStatus(id, 'deleted');

//     // Clear queue_entry_id from session but keep session for history
//     await supabase
//       .from('wa_sessions')
//       .update({ state: 'idle', updated_at: new Date().toISOString() })
//       .eq('queue_entry_id', id);

//     // Recalculate positions for remaining customers
//     await QueueEngine.recalculatePositions(entry.outlet_id);

//     // Trigger notifications for remaining customers whose position improved
//     const remainingEntries = await QueueEngine.getQueueSnapshot(entry.outlet_id);
//     for (const remaining of remainingEntries) {
//       await Notifier.checkAndNotify(remaining.id);
//     }

//     console.log(`[Queue DELETE] Entry deleted: ${id} (${entry.phone})`);

//     return res.status(200).json({ message: 'Entry deleted successfully.' });
//   } catch (err) {
//     console.error('[Queue DELETE] Error:', err.message);
//     return res.status(500).json({ error: 'Failed to delete entry.' });
//   }
// });

// export default router;
// src/routes/queue.js

import { Router }     from 'express';
import authenticate   from '../middleware/authenticate.js';
import QueueEngine    from '../services/QueueEngine.js';
import Notifier       from '../services/Notifier.js';
import ConfigLoader   from '../services/ConfigLoader.js';
import supabase       from '../utils/supabaseClient.js';

const router = Router();
router.use(authenticate);

// ── Guard helper ──────────────────────────────────────────────────────────────
function assertOutletAccess(req, res, outletId) {
  if (req.user.outlet_id !== outletId) {
    res.status(403).json({ error: 'Access denied to this outlet.' });
    return false;
  }
  return true;
}

// ── GET /api/queue/:outletId ──────────────────────────────────────────────────
router.get('/:outletId', async (req, res) => {
  const { outletId } = req.params;
  if (!assertOutletAccess(req, res, outletId)) return;

  try {
    const queue = await QueueEngine.getQueueSnapshot(outletId);
    return res.status(200).json({ queue });
  } catch (err) {
    console.error('[Queue GET] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch queue.' });
  }
});

// ── POST /api/queue/:outletId/entry ───────────────────────────────────────────
router.post('/:outletId/entry', async (req, res) => {
  const { outletId } = req.params;
  if (!assertOutletAccess(req, res, outletId)) return;

  const { phone, party_size, customer_name } = req.body ?? {};

  if (!phone || !party_size) {
    return res.status(400).json({ error: 'phone and party_size are required.' });
  }
  if (!Number.isInteger(party_size) || party_size < 1) {
    return res.status(400).json({ error: 'party_size must be a positive integer.' });
  }

  try {
    // ── Step 1: Get outlet config ───────────────────────────────────────────
    const { data: outletRow, error: outletErr } = await supabase
      .from('outlets')
      .select('id, slug')
      .eq('id', outletId)
      .single();

    if (outletErr || !outletRow) {
      console.error('[Queue POST] Outlet not found in DB for id:', outletId, outletErr);
      return res.status(500).json({ error: 'Outlet not found.' });
    }

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);
    if (!outlet) {
      console.error('[Queue POST] Outlet not found in config for slug:', outletRow.slug);
      return res.status(500).json({ error: 'Outlet configuration not found.' });
    }

    // ── Step 2: Create entry ────────────────────────────────────────────────
    const entry = await QueueEngine.createEntry({
      outlet_id:     outletId,
      phone:         phone.trim(),
      party_size,
      customer_name: customer_name?.trim() ?? null,
    });

    console.log('[Queue POST] Entry created:', entry.id);

    // ── Step 3: Recalculate positions ───────────────────────────────────────
    await QueueEngine.recalculatePositions(outletId);

    // ── Step 4: Re-fetch to get assigned position ───────────────────────────
    const updatedEntry = await QueueEngine.getEntryById(entry.id);
    if (!updatedEntry) {
      console.error('[Queue POST] Entry not found after recalculate:', entry.id);
      return res.status(500).json({ error: 'Entry created but position assignment failed.' });
    }

    const position = updatedEntry.position;
    console.log('[Queue POST] Position assigned:', position);

    // ── Step 5: Calculate and store wait time + initial_position ────────────
    const estimatedWait = QueueEngine.calculateWaitTime(outlet, position);

    await QueueEngine.updateEntryFields(entry.id, {
      initial_position:    position,
      estimated_wait_mins: estimatedWait,
    });

    console.log('[Queue POST] Fields updated — initial_position:', position, 'estimated_wait:', estimatedWait);

    // ── Step 6: Create wa_session so notifications work ─────────────────────
    const { error: sessionErr } = await supabase
      .from('wa_sessions')
      .upsert({
        phone:               phone.trim(),
        outlet_id:           outletId,
        state:               'in_queue',
        queue_entry_id:      entry.id,
        notifications_sent:  0,
        updated_at:          new Date().toISOString(),
      }, { onConflict: 'phone' });

    if (sessionErr) {
      // Non-critical — log but don't fail the request
      console.warn('[Queue POST] wa_session upsert warning:', sessionErr.message);
    }

    // ── Step 7: Return final entry state ────────────────────────────────────
    const finalEntry = await QueueEngine.getEntryById(entry.id);

    console.log(
      `[Queue POST] Walk-in added: ${phone}, ` +
      `party=${party_size}, position=${position}, ` +
      `wait=${estimatedWait}min, outlet=${outlet.name}`
    );

    return res.status(201).json({ entry: finalEntry });

  } catch (err) {
    console.error('[Queue POST] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Failed to create queue entry.' });
  }
});

// ── PATCH /api/queue/entry/:id/seat ──────────────────────────────────────────
router.patch('/entry/:id/seat', async (req, res) => {
  const { id } = req.params;

  try {
    const entry = await QueueEngine.getEntryById(id);
    if (!entry) return res.status(404).json({ error: 'Queue entry not found.' });
    if (!assertOutletAccess(req, res, entry.outlet_id)) return;
    if (entry.status !== 'waiting') {
      return res.status(400).json({
        error: `Entry cannot be seated — current status is '${entry.status}'.`,
      });
    }

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);

    // Mark as seated
    await QueueEngine.updateEntryStatus(id, 'seated');

    // Update session
    await supabase
      .from('wa_sessions')
      .update({ state: 'done', updated_at: new Date().toISOString() })
      .eq('queue_entry_id', id);

    // Recalculate remaining queue
    await QueueEngine.recalculatePositions(entry.outlet_id);

    // Send WA table-confirmed message
    if (outlet) {
      await Notifier.sendEventMessage(entry, outlet, 'seat');
    }

    // Trigger notifications for remaining customers
    const remainingEntries = await QueueEngine.getQueueSnapshot(entry.outlet_id);
    for (const remaining of remainingEntries) {
      await Notifier.checkAndNotify(remaining.id);
    }

    const updatedEntry = await QueueEngine.getEntryById(id);
    console.log(`[Queue PATCH] Entry seated: ${id}`);
    return res.status(200).json({ entry: updatedEntry });

  } catch (err) {
    console.error('[Queue PATCH seat] Error:', err.message);
    return res.status(500).json({ error: 'Failed to seat entry.' });
  }
});

// ── DELETE /api/queue/entry/:id ───────────────────────────────────────────────
router.delete('/entry/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const entry = await QueueEngine.getEntryById(id);
    if (!entry) return res.status(404).json({ error: 'Queue entry not found.' });
    if (!assertOutletAccess(req, res, entry.outlet_id)) return;
    if (entry.status !== 'waiting') {
      return res.status(400).json({
        error: `Entry cannot be deleted — current status is '${entry.status}'.`,
      });
    }

    await QueueEngine.updateEntryStatus(id, 'deleted');

    await supabase
      .from('wa_sessions')
      .update({ state: 'idle', updated_at: new Date().toISOString() })
      .eq('queue_entry_id', id);

    await QueueEngine.recalculatePositions(entry.outlet_id);

    const remainingEntries = await QueueEngine.getQueueSnapshot(entry.outlet_id);
    for (const remaining of remainingEntries) {
      await Notifier.checkAndNotify(remaining.id);
    }

    console.log(`[Queue DELETE] Entry deleted: ${id}`);
    return res.status(200).json({ message: 'Entry deleted successfully.' });

  } catch (err) {
    console.error('[Queue DELETE] Error:', err.message);
    return res.status(500).json({ error: 'Failed to delete entry.' });
  }
});

export default router;