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

    // ── WhatsApp Flow completion ───────────────────────────────────────────
    // When customer submits the feedback Flow, WhatsApp delivers an
    // interactive.nfm_reply message containing the Flow's final payload
    // as a JSON string in response_json. This bypasses normal text routing
    // since it's not tied to wa_session state machine transitions.
    if (msg.interactive?.type === 'nfm_reply') {
      const lockKey = `${phone}:${msg.id}`;
      if (_processing.has(lockKey)) {
        console.log(`[StateMachine] Duplicate flow reply ignored: ${lockKey}`);
        return;
      }
      _processing.add(lockKey);
      setTimeout(() => _processing.delete(lockKey), 10000);

      await StateMachine.handleFlowReply(phone, msg);
      return;
    }

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

        // Star rating tap while idle — could be a rating reply where session
        // was reset after seating. Look up most recent seated entry by phone.
        if (WhatsAppService.parseStarRating(text) !== null) {
          const starRating = WhatsAppService.parseStarRating(text);
          await StateMachine.handleReviewRating(phone, starRating, session, customerName);
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

        // Customer tapped "10+" — send sub-menu with exact sizes 10-19
        // Do NOT create a queue entry yet; wait for the exact number
        if (text?.trim().startsWith('10+')) {
          await WhatsAppService.sendLargePartyPrompt(phone, customerName);
          console.log(`[StateMachine] Large party prompt sent to ${phone}`);
          break;
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
      case 'done': {
        // If customer taps a stale Cancel button — ignore it
        if (WhatsAppService.isCancelMessage(text)) {
          console.log(`[StateMachine] Stale cancel tap in ${session.state} state — ignoring.`);
          return;
        }

        // Star rating buttons (4 Star, 5 Star, 3 Star or less) are now handled
        // by Snapto's chatbot flow — our backend only needs to handle the
        // overall_rating DB update when these arrive here as a fallback.
        const starRating = WhatsAppService.parseStarRating(text);
        if (starRating !== null && session.queue_entry_id) {
          await StateMachine.handleReviewRating(phone, starRating, session, customerName);
          break;
        }

        // Any BUTTON tap that isn't recognized should be ignored —
        // only plain typed TEXT starts a new queue session.
        if (msg.type === 'button' || msg.type === 'interactive') {
          console.log(
            `[StateMachine] Unrecognized button tap "${text}" in ${session.state} state — ignoring.`
          );
          return;
        }

        // Customer typed a fresh text message — start over
        await StateMachine._resetSession(phone);
        session.state = 'idle';
        await StateMachine.handleNew(phone, text, session, customerName);
        break;
      }

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

  // ── handleReviewRating ────────────────────────────────────────────────────
  /**
   * handleReviewRating(phone, starRating, session)
   *
   * Customer replied with a star rating (1-5) to the review request.
   * 4-5 stars → positive thank-you message.
   * 1-3 stars → apology message + feedback form CTA.
   */
  static async handleReviewRating(phone, starRating, session, liveCustomerName = null) {
    // Phone is stored in DB without country code prefix in older entries
    // e.g. DB has '8930188922' but phone param is '+918930188922'
    // Build multiple formats to search across all possible stored formats
    const phoneVariants = [
      phone,                                    // +918930188922
      phone.replace(/^\+/, ''),                 // 918930188922
      phone.replace(/^\+91/, ''),               // 8930188922
      phone.replace(/^\+/, '').replace(/^91/, '') // 8930188922 (alt)
    ];

    // Find most recent seated entry for this phone across all formats
    // Accept any review_state except already-completed ones
    const { data: entry } = await supabase
      .from('queue_entries')
      .select('id, customer_name, outlet_id, review_state')
      .in('phone', phoneVariants)
      .eq('status', 'seated')
      .not('review_state', 'in', '("rated","completed","feedback_requested")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!entry) {
      console.warn(`[StateMachine] No seated entry found for review rating from ${phone}`);
      return;
    }

    // Guard: only accept rating once
    if (entry.review_state === 'rated' || entry.review_state === 'completed') {
      console.log(`[StateMachine] Rating already recorded for entry ${entry.id} — ignoring.`);
      return;
    }

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);

    // Priority: live WhatsApp profile name > entry name > session name
    let customerName = liveCustomerName || entry.customer_name;
    if (!customerName) {
      const { data: sess } = await supabase
        .from('wa_sessions')
        .select('customer_name')
        .eq('queue_entry_id', entry.id)
        .maybeSingle();
      customerName = sess?.customer_name ?? null;
    }

    // Update entry customer_name if it was null
    if (customerName && !entry.customer_name) {
      await supabase
        .from('queue_entries')
        .update({ customer_name: customerName })
        .eq('id', entry.id);
    }

    // Store overall rating
    await supabase
      .from('queue_entries')
      .update({
        overall_rating: starRating,
        review_state:   starRating >= 4 ? 'rated' : 'feedback_requested',
      })
      .eq('id', entry.id);

    console.log(`[StateMachine] Review rating ${starRating}★ saved for entry ${entry.id}`);

    if (starRating >= 4) {
      // Positive — Snapto chatbot sends the positive template
      // We only save to DB here; no WA message needed from backend
      console.log(`[StateMachine] Positive review (${starRating}★) recorded for ${phone}`);
    } else {
      // Negative — Snapto chatbot sends the negative template + Flow
      // We only save to DB here; no WA message needed from backend
      console.log(`[StateMachine] Negative review (${starRating}★) recorded for ${phone} — Snapto handles negative template`);
    }
  }

  // ── handleFlowReply ───────────────────────────────────────────────────────
  /**
   * handleFlowReply(phone, msg)
   *
   * Customer completed the WhatsApp Flow feedback form.
   * msg.interactive.nfm_reply.response_json is a JSON STRING containing:
   *   { food_rating, ambiance_rating, service_rating, user_feedback }
   *
   * Finds the customer's most recent entry awaiting feedback
   * (review_state = 'feedback_requested') and saves the detailed ratings.
   */
  static async handleFlowReply(phone, msg) {
    const rawResponse = msg.interactive?.nfm_reply?.response_json;

    console.log('[FlowReply] nfm_reply object:', JSON.stringify(msg.interactive?.nfm_reply));
    console.log('[FlowReply] response_json:', rawResponse);

    if (!rawResponse) {
      console.warn(`[StateMachine] Flow reply with no response_json from ${phone}`);
      return;
    }

    let parsed;
    try {
      parsed = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
    } catch (err) {
      console.error(`[StateMachine] Failed to parse flow response_json:`, err.message, rawResponse);
      return;
    }

    console.log('[FlowReply] Parsed keys:', Object.keys(parsed));
    console.log('[FlowReply] Parsed values:', JSON.stringify(parsed));

    // Snapto Flow values look like: "4_★☆☆☆☆_•_Very_Poor_(1/5)"
    // The actual star rating is the number before "/5" in parentheses
    const extractRating = (val) => {
      if (!val) return null;
      const match = String(val).match(/\((\d)\/5\)/);
      if (match) return parseInt(match[1], 10);
      // Fallback: try first character (for simple numeric IDs)
      const n = parseInt(String(val).charAt(0), 10);
      return (n >= 1 && n <= 5) ? n : null;
    };

    // Find keys dynamically — don't hardcode since Snapto may vary
    const foodKey     = Object.keys(parsed).find(k => k.toLowerCase().includes('food'));
    const ambianceKey = Object.keys(parsed).find(k => k.toLowerCase().includes('ambien'));
    const serviceKey  = Object.keys(parsed).find(k => k.toLowerCase().includes('customer_service') || k.toLowerCase().includes('service'));
    const feedbackKey = Object.keys(parsed).find(k => k.toLowerCase().includes('comment') || k.toLowerCase().includes('feedback') || k.toLowerCase().includes('leave'));

    const foodRating     = extractRating(parsed[foodKey]);
    const ambianceRating = extractRating(parsed[ambianceKey]);
    const serviceRating  = extractRating(parsed[serviceKey]);
    const userFeedback   = feedbackKey ? (parsed[feedbackKey]?.trim() || null) : null;

    console.log(`[FlowReply] Extracted — food=${foodRating}, ambiance=${ambianceRating}, service=${serviceRating}, feedback="${userFeedback}"`);

    // Build phone variants to match across all stored formats
    const phoneVariants = [
      phone,
      phone.replace(/^\+/, ''),
      phone.replace(/^\+91/, ''),
    ];

    // Find the entry awaiting detailed feedback for this phone.
    const { data: entry, error } = await supabase
      .from('queue_entries')
      .select('id, customer_name, review_state')
      .in('phone', phoneVariants)
      .eq('review_state', 'feedback_requested')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !entry) {
      console.warn(`[StateMachine] No entry awaiting feedback for ${phone} — ignoring flow reply.`);
      return;
    }

    await supabase
      .from('queue_entries')
      .update({
        food_rating:     foodRating,
        ambiance_rating: ambianceRating,
        service_rating:  serviceRating,
        user_feedback:   userFeedback,
        review_state:    'completed',
      })
      .eq('id', entry.id);

    // Get best available customer name
    let customerName = entry.customer_name;
    if (!customerName) {
      const { data: sess } = await supabase
        .from('wa_sessions')
        .select('customer_name')
        .eq('queue_entry_id', entry.id)
        .maybeSingle();
      customerName = sess?.customer_name ?? null;
    }

    // Send thank-you message
    try {
      await WhatsAppService.sendReviewThankYou(phone, customerName);
    } catch (waErr) {
      console.warn('[StateMachine] Thank-you send failed:', waErr.message);
    }

    // Send low rating alert to all manager alert_phones for this outlet
    try {
      const { data: entryFull } = await supabase
        .from('queue_entries')
        .select('outlet_id, phone')
        .eq('id', entry.id)
        .single();

      const { data: outletRow } = await supabase
        .from('outlets')
        .select('slug')
        .eq('id', entryFull?.outlet_id)
        .single();

      const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);

      if (outlet?.alert_phones?.length) {
        for (const alertPhone of outlet.alert_phones) {
          await WhatsAppService.sendLowRatingAlert(
            alertPhone,
            outlet.name,
            customerName,
            foodRating,
            ambianceRating,
            serviceRating,
            userFeedback,
            entryFull.phone
          );
        }
        console.log(`[StateMachine] Low rating alert sent to ${outlet.alert_phones.length} manager(s)`);
      }
    } catch (alertErr) {
      console.warn('[StateMachine] Low rating alert failed:', alertErr.message);
    }

    console.log(
      `[StateMachine] Feedback Flow completed for entry ${entry.id} — ` +
      `food=${foodRating}, ambiance=${ambianceRating}, service=${serviceRating}`
    );
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