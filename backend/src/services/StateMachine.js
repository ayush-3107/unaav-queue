// src/services/StateMachine.js
//
// Core WhatsApp chatbot logic.
// Processes every incoming message by reading the customer's current state
// from wa_sessions and routing to the correct handler.
//
// States:
//   idle              — no active session, or session expired
//   awaiting_party_size — customer sent the identifier, waiting for party size
//   in_queue          — customer has a queue entry
//   cancelled         — customer cancelled their reservation
//   done              — customer was seated

import supabase         from '../utils/supabaseClient.js';
import ConfigLoader     from './ConfigLoader.js';
import QueueEngine      from './QueueEngine.js';
import WhatsAppService  from './WhatsAppService.js';
import Notifier         from './Notifier.js';

class StateMachine {
  /**
   * handleIncomingMessage(msg)
   *
   * Entry point. Called by POST /webhook for every incoming message.
   * Extracts phone, type, text, and button reply from the Meta payload.
   * Reads wa_session and routes to the correct handler.
   *
   * Meta message shape:
   *   msg.from          — customer phone with country code e.g. '919810012345'
   *   msg.type          — 'text' | 'interactive'
   *   msg.text.body     — for text messages
   *   msg.interactive.list_reply.id    — for list reply (party size)
   *   msg.interactive.button_reply.id  — for button reply (cancel)
   *
   * @param {object} msg — message object from Meta webhook payload
   */
  static async handleIncomingMessage(msg) {
    // Normalise phone — Meta sends without '+', we store with '+'
    const phone = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;
    const type  = msg.type;

    // Extract text or button/list reply id
    let text       = null;
    let replyId    = null;

    if (type === 'text') {
      text = msg.text?.body?.trim() ?? '';
    } else if (type === 'interactive') {
      replyId = (
        msg.interactive?.list_reply?.id ??
        msg.interactive?.button_reply?.id ??
        null
      );
    }

    // Fetch or create session
    const session = await StateMachine._getOrCreateSession(phone);

    // Check if session has expired (> 24h since last customer message)
    if (session.session_expires_at && new Date() > new Date(session.session_expires_at)) {
      await StateMachine._resetSession(phone);
      session.state = 'idle';
    }

    // Always update session expiry on incoming message
    await StateMachine._touchSession(phone);

    console.log(`[StateMachine] Phone: ${phone}, State: ${session.state}, Type: ${type}`);

    // ── Route by state ────────────────────────────────────────────────────────
    switch (session.state) {
      case 'idle':
        await StateMachine.handleNew(phone, text, session);
        break;

      case 'awaiting_party_size':
        if (replyId) {
          await StateMachine.handlePartySize(phone, replyId, session);
        } else {
          // Customer typed something instead of tapping — re-prompt
          await StateMachine._promptPartySizeAgain(phone, session);
        }
        break;

      case 'in_queue':
        if (replyId === 'cancel') {
          await StateMachine.handleCancel(phone, session);
        } else {
          // Any other message while in queue — remind them of position
          await StateMachine.handleActiveQueueMessage(phone, session);
        }
        break;

      case 'cancelled':
      case 'done':
      default:
        await StateMachine.handleUnknown(phone, session);
        break;
    }
  }

  // ── State handlers ──────────────────────────────────────────────────────────

  /**
   * handleNew(phone, text, session)
   *
   * State: idle
   * Triggered when: message text matches an outlet's wa_identifier.
   * Action: identify outlet, fetch customer name, send party size list.
   */
  static async handleNew(phone, text, session) {
    // Match message text against outlet identifiers
    const outlet = ConfigLoader.getInstance().getOutletByIdentifier(text);

    if (!outlet) {
      // Text doesn't match any outlet — send usage hint
      await StateMachine.handleUnknown(phone, session);
      return;
    }

    // Check opening hours
    if (!StateMachine._isWithinHours(outlet)) {
      // Outside hours — no queue entry, no response in v1
      // (closing time message removed per spec)
      console.log(`[StateMachine] Message outside hours for ${outlet.slug}. Ignored.`);
      return;
    }

    // Fetch customer's WhatsApp profile name (non-critical, may return null)
    const customerName = await WhatsAppService.fetchProfileName(phone);

    // Fetch the outlet's Supabase ID
    const { data: outletRow } = await supabase
      .from('outlets')
      .select('id')
      .eq('slug', outlet.slug)
      .single();

    if (!outletRow) {
      console.error('[StateMachine] Outlet not found in DB:', outlet.slug);
      return;
    }

    // Update session: state → awaiting_party_size
    await supabase
      .from('wa_sessions')
      .upsert({
        phone,
        outlet_id:   outletRow.id,
        state:       'awaiting_party_size',
        // Store name temporarily in session for use in handlePartySize
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'phone' });

    // Store customer name in session metadata (use a temp column approach)
    // We'll pass it along via the session object
    session._customerName = customerName;
    session._outletId     = outletRow.id;
    session._outlet       = outlet;

    // Build and send party size interactive list
    const { bodyText, sections } = WhatsAppService.buildPartySizeList(
      outlet.name,
      outlet.max_party_size
    );

    await WhatsAppService.sendInteractiveList(
      phone,
      outlet.wa_phone_number_id,
      bodyText,
      sections
    );

    console.log(`[StateMachine] Party size prompt sent to ${phone} for ${outlet.name}`);
  }

  /**
   * handlePartySize(phone, replyId, session)
   *
   * State: awaiting_party_size
   * Triggered when: customer taps a party size from the list.
   * Action: create queue entry, calculate wait, send confirmation.
   */
  static async handlePartySize(phone, replyId, session) {
    // Parse party size from reply ID ('1' through '10')
    const partySize = parseInt(replyId, 10);
    if (isNaN(partySize) || partySize < 1) {
      await StateMachine._promptPartySizeAgain(phone, session);
      return;
    }

    // Fetch full session from DB to get outlet_id
    const { data: fullSession } = await supabase
      .from('wa_sessions')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!fullSession?.outlet_id) {
      console.error('[StateMachine] Session missing outlet_id for phone:', phone);
      return;
    }

    // Fetch outlet config and DB row
    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', fullSession.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);
    if (!outlet) return;

    // Create queue entry
    const entry = await QueueEngine.createEntry({
      outlet_id:     fullSession.outlet_id,
      phone,
      party_size:    partySize,
      customer_name: session._customerName ?? null,
    });

    // Recalculate all positions — this gives our new entry its position
    await QueueEngine.recalculatePositions(fullSession.outlet_id);

    // Re-fetch entry to get the assigned position
    const updatedEntry = await QueueEngine.getEntryById(entry.id);
    const position     = updatedEntry.position;

    // Calculate estimated wait time
    const estimatedWait = QueueEngine.calculateWaitTime(outlet, position);

    // Store initial_position and estimated_wait_mins on the entry
    await QueueEngine.updateEntryFields(entry.id, {
      initial_position:    position,
      estimated_wait_mins: estimatedWait,
    });

    // Update wa_session: state → in_queue, link queue_entry_id
    await supabase
      .from('wa_sessions')
      .update({
        state:               'in_queue',
        queue_entry_id:      entry.id,
        notifications_sent:  1,       // Confirmation counts as #1
        updated_at:          new Date().toISOString(),
      })
      .eq('phone', phone);

    // Send Update #1 — confirmation with Cancel button
    const confirmText = WhatsAppService.buildConfirmationMessage(
      outlet.name,
      position,
      estimatedWait
    );

    await WhatsAppService.sendInteractiveButton(
      phone,
      outlet.wa_phone_number_id,
      confirmText,
      WhatsAppService.CANCEL_BUTTON
    );

    // Log the confirmation notification
    await Notifier.logNotification(entry.id, 1, 'sent');

    console.log(
      `[StateMachine] Queue entry created for ${phone}: ` +
      `position=${position}, wait=${estimatedWait}min, party=${partySize}`
    );

    // Check if any OTHER waiting customers need a notification
    // (in case this new entry changed their position — unlikely but safe)
    const waitingEntries = await QueueEngine.getQueueSnapshot(fullSession.outlet_id);
    for (const waitingEntry of waitingEntries) {
      if (waitingEntry.id !== entry.id) {
        await Notifier.checkAndNotify(waitingEntry.id);
      }
    }
  }

  /**
   * handleCancel(phone, session)
   *
   * State: in_queue
   * Triggered when: customer taps Cancel My Reservation button (reply id = 'cancel').
   * Action: mark entry cancelled, recalculate positions, send cancellation message.
   */
  static async handleCancel(phone, session) {
    const { data: fullSession } = await supabase
      .from('wa_sessions')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!fullSession?.queue_entry_id) {
      // Session inconsistency — reset to idle
      await StateMachine._resetSession(phone);
      return;
    }

    const entry = await QueueEngine.getEntryById(fullSession.queue_entry_id);
    if (!entry || entry.status !== 'waiting') {
      await StateMachine._resetSession(phone);
      return;
    }

    const outletRow = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.data.slug);

    // Mark entry as cancelled
    await QueueEngine.updateEntryStatus(entry.id, 'cancelled');

    // Update session state
    await supabase
      .from('wa_sessions')
      .update({ state: 'cancelled', updated_at: new Date().toISOString() })
      .eq('phone', phone);

    // Recalculate positions for remaining customers
    await QueueEngine.recalculatePositions(entry.outlet_id);

    // Send cancellation confirmation message
    await Notifier.sendEventMessage(entry, outlet, 'cancel');

    // Trigger notifications for remaining customers whose position improved
    const remainingEntries = await QueueEngine.getQueueSnapshot(entry.outlet_id);
    for (const remainingEntry of remainingEntries) {
      await Notifier.checkAndNotify(remainingEntry.id);
    }

    console.log(`[StateMachine] Reservation cancelled for ${phone}`);
  }

  /**
   * handleActiveQueueMessage(phone, session)
   *
   * State: in_queue, but customer sent something other than a cancel button.
   * Action: remind them of their position and how to cancel.
   */
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
      .select('slug, wa_phone_number_id')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);

    await WhatsAppService.sendText(
      phone,
      outlet.wa_phone_number_id,
      WhatsAppService.buildActiveQueueReminderMessage(entry.position)
    );
  }

  /**
   * handleUnknown(phone, session)
   *
   * Catch-all for unrecognised messages or expired/done sessions.
   * Sends a usage hint.
   */
  static async handleUnknown(phone, session) {
    // Determine which outlet's number to reply from
    // If session has an outlet_id, use that; otherwise use first outlet as fallback
    let phoneNumberId = null;

    if (session?.outlet_id) {
      const { data: outletRow } = await supabase
        .from('outlets')
        .select('slug')
        .eq('id', session.outlet_id)
        .single();

      if (outletRow) {
        const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);
        phoneNumberId = outlet?.wa_phone_number_id;
      }
    }

    // Final fallback — use first outlet's number
    if (!phoneNumberId) {
      const allOutlets = ConfigLoader.getInstance().getAllOutlets();
      phoneNumberId = allOutlets[0]?.wa_phone_number_id;
    }

    if (!phoneNumberId) {
      console.warn('[StateMachine] No phoneNumberId available for unknown message reply.');
      return;
    }

    await WhatsAppService.sendText(
      phone,
      phoneNumberId,
      WhatsAppService.buildUnknownMessage()
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * _getOrCreateSession(phone)
   * Fetches wa_session by phone. Creates a new idle session if none exists.
   */
  static async _getOrCreateSession(phone) {
    const { data: existing } = await supabase
      .from('wa_sessions')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existing) return existing;

    // Create new idle session
    const { data: created } = await supabase
      .from('wa_sessions')
      .insert({
        phone,
        state:      'idle',
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    return created;
  }

  /**
   * _touchSession(phone)
   * Updates session_expires_at to now + 24 hours on every incoming message.
   */
  static async _touchSession(phone) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('wa_sessions')
      .update({ session_expires_at: expiresAt, updated_at: new Date().toISOString() })
      .eq('phone', phone);
  }

  /**
   * _resetSession(phone)
   * Resets session to idle state, clears queue_entry_id linkage.
   */
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

  /**
   * _promptPartySizeAgain(phone, session)
   * Re-sends the party size list when customer sends unexpected input.
   */
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

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow.slug);
    if (!outlet) return;

    const { bodyText, sections } = WhatsAppService.buildPartySizeList(
      outlet.name,
      outlet.max_party_size
    );

    // Prepend a gentle prompt
    const text = `Please tap one of the options below to select your party size:\n\n${bodyText}`;

    await WhatsAppService.sendInteractiveList(
      phone,
      outlet.wa_phone_number_id,
      text,
      sections
    );
  }

  /**
   * _isWithinHours(outlet)
   * Returns true if the current time is within the outlet's opening hours.
   *
   * @param   {object}  outlet — outlet config object
   * @returns {boolean}
   */
  static _isWithinHours(outlet) {
    const now   = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const mins  = now.getMinutes().toString().padStart(2, '0');
    const current = `${hours}:${mins}`;

    return current >= outlet.opening_time && current < outlet.closing_time;
  }
}

export default StateMachine;