// src/routes/queue.js

import { Router }     from 'express';
import authenticate   from '../middleware/authenticate.js';
import QueueEngine    from '../services/QueueEngine.js';
import Notifier       from '../services/Notifier.js';
import WhatsAppService from '../services/WhatsAppService.js';
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
    const { data: outletRow, error: outletErr } = await supabase
      .from('outlets')
      .select('id, slug')
      .eq('id', outletId)
      .single();

    if (outletErr || !outletRow) {
      console.error('[Queue POST] Outlet not found in DB:', outletId, outletErr);
      return res.status(500).json({ error: 'Outlet not found.' });
    }

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);
    if (!outlet) {
      console.error('[Queue POST] Outlet not found in config:', outletRow.slug);
      return res.status(500).json({ error: 'Outlet configuration not found.' });
    }

    const entry = await QueueEngine.createEntry({
      outlet_id:     outletId,
      phone:         phone.trim(),
      party_size,
      customer_name: customer_name?.trim() ?? null,
    });

    console.log('[Queue POST] Entry created:', entry.id);

    await QueueEngine.recalculatePositions(outletId);

    const updatedEntry = await QueueEngine.getEntryById(entry.id);
    if (!updatedEntry) {
      return res.status(500).json({ error: 'Entry created but position assignment failed.' });
    }

    const position      = updatedEntry.position;
    const estimatedWait = QueueEngine.calculateWaitTime(outlet, position);

    await QueueEngine.updateEntryFields(entry.id, {
      initial_position:    position,
      estimated_wait_mins: estimatedWait,
    });

    const { error: sessionErr } = await supabase
      .from('wa_sessions')
      .upsert({
        phone:              phone.trim(),
        outlet_id:          outletId,
        state:              'in_queue',
        queue_entry_id:     entry.id,
        notifications_sent: 0,
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'phone' });

    if (sessionErr) {
      console.warn('[Queue POST] wa_session upsert warning:', sessionErr.message);
    }

    const finalEntry = await QueueEngine.getEntryById(entry.id);

    // Send WA confirmation message to customer
    try {
      await WhatsAppService.sendConfirmation(
        phone.trim(),
        customer_name?.trim() ?? null,
        outlet.name,
        position,
        estimatedWait
      );
      await Notifier.logNotification(entry.id, 1, 'sent');
      // Mark notifications_sent = 1 on session
      await supabase
        .from('wa_sessions')
        .update({ notifications_sent: 1 })
        .eq('queue_entry_id', entry.id);
    } catch (waErr) {
      // Non-critical — entry is created even if WA message fails
      console.warn('[Queue POST] WA confirmation failed:', waErr.message);
      await Notifier.logNotification(entry.id, 1, 'failed', waErr.message);
    }

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

    await QueueEngine.updateEntryStatus(id, 'seated');

    await supabase
      .from('wa_sessions')
      .update({ state: 'done', updated_at: new Date().toISOString() })
      .eq('queue_entry_id', id);

    await QueueEngine.recalculatePositions(entry.outlet_id);

    if (outlet) {
      await Notifier.sendEventMessage(entry, outlet, 'seat');
    }

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

    // Fetch outlet for WA message
    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = outletRow
      ? ConfigLoader.getInstance().getOutletBySlug(outletRow.slug)
      : null;

    // Soft delete
    await QueueEngine.updateEntryStatus(id, 'deleted');

    // Update session state
    await supabase
      .from('wa_sessions')
      .update({ state: 'idle', updated_at: new Date().toISOString() })
      .eq('queue_entry_id', id);

    // Send WA deletion notification to customer
    if (outlet) {
      await Notifier.sendEventMessage(entry, outlet, 'delete');
    } else {
      console.warn('[Queue DELETE] No outlet found — skipping WA message');
    }

    // Recalculate positions for remaining customers
    await QueueEngine.recalculatePositions(entry.outlet_id);

    // Trigger notifications for remaining customers
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