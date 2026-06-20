// src/services/StateMachine.js

import supabase         from '../utils/supabaseClient.js';
import ConfigLoader     from './ConfigLoader.js';
import QueueEngine      from './QueueEngine.js';
import WhatsAppService  from './WhatsAppService.js';
import Notifier         from './Notifier.js';

// ── Processing lock ───────────────────────────────────────────────────────────
// Prevents duplicate processing if Snapto delivers the same message twice
// or customer taps a button multiple times quickly.
const _processing = new Set();

class StateMachine {

  static async handleIncomingMessage(msg) {
    const phone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;

    // Extract text from all payload locations Snapto uses
    const text =
      msg.text?.body?.trim()                       ??
      msg.button?.text?.trim()                     ??
      msg.interactive?.button_reply?.title?.trim() ??
      msg.interactive?.list_reply?.title?.trim()   ??
      null;

    const customerName = msg._customerName ?? null;

    // ── Deduplication lock ────────────────────────────────────────────────
    // Use phone + message id as lock key
    const lockKey = `${phone}:${msg.id}`;
    if (_processing.has(lockKey)) {
      console.log(`[StateMachine] Duplicate message ignored: ${lockKey}`);
      return;
    }
    _processing.add(lockKey);
    // Auto-release lock after 10 seconds
    setTimeout(() => _processing.delete(lockKey), 10000);

    console.log(`[StateMachine] Incoming — phone: ${phone}, text: "${text}", type: ${msg.type}`);

    const session = await StateMachine._getOrCreateSession(phone);

    // Reset expired session (> 24h)
    if (session.session_expires_at && new Date() > new Date(session.session_expires_at)) {
      await StateMachine._resetSession(phone);
      session.state = 'idle';
    }

    await StateMachine._touchSession(phone);

    console.log(`[StateMachine] State: ${session.state}`);

    // ── Route by state ────────────────────────────────────────────────────
    switch (session.state) {

      case 'idle':
        // If customer taps a stale Cancel button while idle — ignore it
        if (WhatsAppService.isCancelMessage(text)) {
          console.log(`[StateMachine] Stale cancel tap in idle state from ${phone} — ignoring.`);
          return;
        }
        await StateMachine.handleNew(phone, text, session, customerName);
        break;

      case 'awaiting_party_size': {
        // Check if this is a cancel button tap (shouldn't happen here but safe to handle)
        if (WhatsAppService.isCancelMessage(text)) {
          // Customer cancelled before even joining — just reset
          await StateMachine._resetSession(phone);
          console.log(`[StateMachine] Cancel before join — session reset for ${phone}`);
          return;
        }

        const partySize = WhatsAppService.parsePartySize(text);
        if (partySize) {
          await StateMachine.handlePartySize(phone, partySize, session, customerName);
        } else {
          // Text doesn't match any party size — re-send welcome
          await StateMachine._promptPartySizeAgain(phone, session);
        }
        break;
      }

      case 'in_queue':
        if (WhatsAppService.isCancelMessage(text)) {
          await StateMachine.handleCancel(phone, session);
        } else {
          await StateMachine.handleActiveQueueMessage(phone, session);
        }
        break;

      case 'cancelled':
      case 'done':
        // If customer taps a stale Cancel button — ignore it
        if (WhatsAppService.isCancelMessage(text)) {
          console.log(`[StateMachine] Stale cancel tap in ${session.state} state — ignoring.`);
          return;
        }
        // Customer is starting fresh with a new message
        await StateMachine._resetSession(phone);
        session.state = 'idle';
        await StateMachine.handleNew(phone, text, session, customerName);
        break;

      default:
        await StateMachine.handleUnknown(phone, session);
        break;
    }
  }

  // ── handleNew ─────────────────────────────────────────────────────────────
  static async handleNew(phone, text, session, customerName = null) {
    const outlet = ConfigLoader.getInstance().getOutletByIdentifier(text);

    if (!outlet) {
      await StateMachine.handleUnknown(phone, session);
      return;
    }

    if (!StateMachine._isWithinHours(outlet)) {
      console.log(`[StateMachine] Outside hours for ${outlet.slug} — ignoring.`);
      return;
    }

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('id')
      .eq('slug', outlet.slug)
      .single();

    if (!outletRow) {
      console.error('[StateMachine] Outlet not found in DB:', outlet.slug);
      return;
    }

    // Update session → awaiting_party_size, store customer name
    const { error: upsertErr } = await supabase
      .from('wa_sessions')
      .upsert({
        phone,
        outlet_id:     outletRow.id,
        state:         'awaiting_party_size',
        customer_name: customerName,
        queue_entry_id: null,
        notifications_sent: 0,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'phone' });

    if (upsertErr) {
      console.error('[StateMachine] Session upsert failed:', upsertErr.message);
      return;
    }

    await WhatsAppService.sendWelcome(phone, outlet.name);
    console.log(`[StateMachine] Welcome sent to ${phone} for ${outlet.name}`);
  }

  // ── handlePartySize ───────────────────────────────────────────────────────
  static async handlePartySize(phone, partySize, session, customerName = null) {
    // Fetch fresh session to get outlet_id
    const { data: fullSession } = await supabase
      .from('wa_sessions')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!fullSession?.outlet_id) {
      console.error('[StateMachine] Session missing outlet_id:', phone);
      return;
    }

    // Guard: if session already moved to in_queue, don't create duplicate entry
    if (fullSession.state === 'in_queue') {
      console.warn(`[StateMachine] Already in queue — ignoring duplicate party size for ${phone}`);
      await StateMachine.handleActiveQueueMessage(phone, session);
      return;
    }

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', fullSession.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);
    if (!outlet) return;

    const nameToUse = fullSession.customer_name ?? customerName ?? null;

    // ── CRITICAL: Update session state BEFORE creating entry ─────────────
    // This prevents duplicate entries if message is processed twice
    const { error: lockErr } = await supabase
      .from('wa_sessions')
      .update({
        state:      'in_queue',
        updated_at: new Date().toISOString(),
      })
      .eq('phone', phone)
      .eq('state', 'awaiting_party_size'); // Only update if still awaiting

    if (lockErr) {
      console.error('[StateMachine] Session lock failed:', lockErr.message);
      return;
    }

    // Create queue entry
    const entry = await QueueEngine.createEntry({
      outlet_id:     fullSession.outlet_id,
      phone,
      party_size:    partySize,
      customer_name: nameToUse,
    });

    await QueueEngine.recalculatePositions(fullSession.outlet_id);

    const updatedEntry = await QueueEngine.getEntryById(entry.id);
    const position     = updatedEntry.position;
    const estimatedWait = QueueEngine.calculateWaitTime(outlet, position);

    await QueueEngine.updateEntryFields(entry.id, {
      initial_position:    position,
      estimated_wait_mins: estimatedWait,
    });

    // Link entry to session + set notifications_sent = 1
    await supabase
      .from('wa_sessions')
      .update({
        queue_entry_id:     entry.id,
        notifications_sent: 1,
        updated_at:         new Date().toISOString(),
      })
      .eq('phone', phone);

    // Send confirmation (Update #1)
    await WhatsAppService.sendConfirmation(
      phone, nameToUse, outlet.name, position, estimatedWait
    );

    await Notifier.logNotification(entry.id, 1, 'sent');

    console.log(
      `[StateMachine] Queue entry created — phone: ${phone}, ` +
      `position: ${position}, wait: ${estimatedWait}min, pax: ${partySize}`
    );

    // Check notifications for other waiting customers
    const waitingEntries = await QueueEngine.getQueueSnapshot(fullSession.outlet_id);
    for (const waiting of waitingEntries) {
      if (waiting.id !== entry.id) {
        await Notifier.checkAndNotify(waiting.id);
      }
    }
  }

  // ── handleCancel ──────────────────────────────────────────────────────────
  static async handleCancel(phone, session) {
    const { data: fullSession } = await supabase
      .from('wa_sessions')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!fullSession?.queue_entry_id) {
      // No active entry — stale button tap, silently ignore
      console.log(`[StateMachine] Stale cancel tap from ${phone} — no active entry.`);
      return;
    }

    const entry = await QueueEngine.getEntryById(fullSession.queue_entry_id);
    if (!entry || entry.status !== 'waiting') {
      // Entry already cancelled/seated/deleted — stale button tap
      console.log(`[StateMachine] Stale cancel tap from ${phone} — entry status: ${entry?.status}`);
      await StateMachine._resetSession(phone);
      return;
    }

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);

    await QueueEngine.updateEntryStatus(entry.id, 'cancelled');

    await supabase
      .from('wa_sessions')
      .update({ state: 'cancelled', updated_at: new Date().toISOString() })
      .eq('phone', phone);

    await QueueEngine.recalculatePositions(entry.outlet_id);

    if (outlet) {
      await Notifier.sendEventMessage(entry, outlet, 'cancel');
    }

    const remaining = await QueueEngine.getQueueSnapshot(entry.outlet_id);
    for (const r of remaining) {
      await Notifier.checkAndNotify(r.id);
    }

    console.log(`[StateMachine] Cancelled reservation for ${phone}`);
  }

  // ── handleActiveQueueMessage ──────────────────────────────────────────────
  static async handleActiveQueueMessage(phone, session) {
    const { data: fullSession } = await supabase
      .from('wa_sessions')
      .select('queue_entry_id')
      .eq('phone', phone)
      .single();

    if (!fullSession?.queue_entry_id) return;

    const entry = await QueueEngine.getEntryById(fullSession.queue_entry_id);
    if (!entry || entry.status !== 'waiting') return;

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);
    if (!outlet) return;

    // Remind customer of their current position
    await WhatsAppService.sendConfirmation(
      phone,
      entry.customer_name,
      outlet.name,
      entry.position,
      entry.estimated_wait_mins
    );
  }

  // ── handleUnknown ─────────────────────────────────────────────────────────
  static async handleUnknown(phone, session) {
    if (session?.outlet_id) {
      const { data: outletRow } = await supabase
        .from('outlets')
        .select('slug')
        .eq('id', session.outlet_id)
        .single();

      if (outletRow) {
        const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);
        if (outlet) {
          await WhatsAppService.sendWelcome(phone, outlet.name);
          return;
        }
      }
    }
    console.warn(`[StateMachine] Unknown message from ${phone} — no outlet context.`);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  static async _getOrCreateSession(phone) {
    const { data: existing } = await supabase
      .from('wa_sessions')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existing) return existing;

    const { data: created } = await supabase
      .from('wa_sessions')
      .insert({ phone, state: 'idle', updated_at: new Date().toISOString() })
      .select()
      .single();

    return created;
  }

  static async _touchSession(phone) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('wa_sessions')
      .update({ session_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('phone', phone);
  }

  static async _resetSession(phone) {
    await supabase
      .from('wa_sessions')
      .update({
        state:              'idle',
        queue_entry_id:     null,
        notifications_sent: 0,
        updated_at:         new Date().toISOString(),
      })
      .eq('phone', phone);
  }

  static async _promptPartySizeAgain(phone, session) {
    const { data: fullSession } = await supabase
      .from('wa_sessions')
      .select('outlet_id')
      .eq('phone', phone)
      .single();

    if (!fullSession?.outlet_id) return;

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', fullSession.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);
    if (!outlet) return;

    await WhatsAppService.sendWelcome(phone, outlet.name);
  }

  static _isWithinHours(outlet) {
  // Convert current time to IST (UTC+5:30) regardless of server timezone
    // Render servers run in UTC — this ensures correct comparison
    // against opening_time/closing_time which are defined in IST
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istTime = new Date(now.getTime() + istOffsetMs);

    const hours   = istTime.getUTCHours().toString().padStart(2, '0');
    const mins    = istTime.getUTCMinutes().toString().padStart(2, '0');
    const current = `${hours}:${mins}`;

    return current >= outlet.opening_time && current < outlet.closing_time;
  }
}

export default StateMachine;