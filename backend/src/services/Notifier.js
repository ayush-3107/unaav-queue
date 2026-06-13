// src/services/Notifier.js
//
// Determines whether a position-update notification should be sent
// and dispatches it. Called after every recalculatePositions() call.
//
// Notification cap: max 3 position updates per customer per visit.
// Event messages (table confirmed, cancellation) are not counted toward the cap.
//
// Update thresholds:
//   #1 — Confirmation  : always sent on join (notifications_sent = 1)
//   #2 — Mid-queue     : position <= floor(initial_position / 2)
//                        AND notifications_sent == 1
//   #3 — Almost ready  : position <= 2
//                        AND notifications_sent == 2

import supabase          from '../utils/supabaseClient.js';
import QueueEngine       from './QueueEngine.js';
import WhatsAppService   from './WhatsAppService.js';
import ConfigLoader      from './ConfigLoader.js';

class Notifier {
  /**
   * checkAndNotify(entryId)
   *
   * Main entry point. Reads the entry and its session, evaluates
   * thresholds, and dispatches at most one notification per call.
   * Called after every recalculatePositions().
   *
   * @param {string} entryId — queue_entry uuid
   */
  static async checkAndNotify(entryId) {
    const entry = await QueueEngine.getEntryById(entryId);

    // Skip if entry is not waiting or doesn't exist
    if (!entry || entry.status !== 'waiting') return;

    // Fetch the WA session to check notification count
    const { data: session, error } = await supabase
      .from('wa_sessions')
      .select('notifications_sent')
      .eq('queue_entry_id', entryId)
      .single();

    if (error || !session) return;

    // Cap enforced — no more updates
    if (session.notifications_sent >= 3) return;

    // Fetch outlet config for message content and phone number ID
    const outlet = ConfigLoader.getInstance().getOutletBySlug(
      await Notifier._getOutletSlug(entry.outlet_id)
    );
    if (!outlet) return;

    // Calculate remaining wait for display in message
    const remainingWait = QueueEngine.calculateWaitTime(outlet, entry.position);

    // ── Check Update #2 threshold ────────────────────────────────────────────
    if (
      session.notifications_sent === 1 &&
      Notifier._shouldSendUpdate(entry, 2)
    ) {
      const text = WhatsAppService.buildMidQueueMessage(entry.position, remainingWait);
      await Notifier.dispatchNotification(
        entry, outlet, 2, text, true /* withCancelButton */
      );
      return; // One notification per recalculate cycle
    }

    // ── Check Update #3 threshold ────────────────────────────────────────────
    if (
      session.notifications_sent === 2 &&
      Notifier._shouldSendUpdate(entry, 3)
    ) {
      const text = WhatsAppService.buildAlmostReadyMessage(entry.position);
      await Notifier.dispatchNotification(
        entry, outlet, 3, text, true /* withCancelButton */
      );
    }
  }

  /**
   * shouldSendUpdate(entry, updateNumber) — private
   *
   * Pure function. Evaluates threshold condition for Update #2 or #3.
   * No side effects.
   *
   * @param   {object}  entry        — queue_entry row
   * @param   {number}  updateNumber — 2 or 3
   * @returns {boolean}
   */
  static _shouldSendUpdate(entry, updateNumber) {
    const { position, initial_position } = entry;

    if (updateNumber === 2) {
      // Position has dropped to 50% or less of initial position
      return position <= Math.floor(initial_position / 2);
    }

    if (updateNumber === 3) {
      // Customer is at position 2 or closer
      return position <= 2;
    }

    return false;
  }

  /**
   * dispatchNotification(entry, outlet, updateNum, text, withCancelButton)
   *
   * Sends the WhatsApp message and logs the result.
   * On success: increments notifications_sent in wa_sessions.
   * On failure: logs to notification_log with status='failed' — does not throw,
   *             so a failed notification doesn't crash the queue flow.
   *
   * @param {object}  entry
   * @param {object}  outlet          — outlet config object
   * @param {number}  updateNum       — 1, 2, or 3 (0 for event messages)
   * @param {string}  text            — message body text
   * @param {boolean} withCancelButton — include Cancel My Reservation button
   */
  static async dispatchNotification(entry, outlet, updateNum, text, withCancelButton = false) {
    try {
      if (withCancelButton) {
        await WhatsAppService.sendInteractiveButton(
          entry.phone,
          outlet.wa_phone_number_id,
          text,
          WhatsAppService.CANCEL_BUTTON
        );
      } else {
        await WhatsAppService.sendText(
          entry.phone,
          outlet.wa_phone_number_id,
          text
        );
      }

      // Log success
      await Notifier.logNotification(entry.id, updateNum, 'sent');

      // Increment notifications_sent — only for position updates (not event msgs)
      if (updateNum > 0) {
        await supabase
          .from('wa_sessions')
          .update({ notifications_sent: supabase.rpc('increment', { x: 1 }) })
          .eq('queue_entry_id', entry.id);

        // Fallback if rpc not available — fetch and increment manually
        await Notifier._incrementNotificationCount(entry.id);
      }

      console.log(
        `[Notifier] Update #${updateNum} sent to ${entry.phone} ` +
        `(entry ${entry.id}, position ${entry.position})`
      );
    } catch (err) {
      console.error(`[Notifier] Failed to send update #${updateNum}:`, err.message);
      await Notifier.logNotification(entry.id, updateNum, 'failed', err.message);
      // Do not re-throw — queue flow must continue even if WA send fails
    }
  }

  /**
   * sendEventMessage(entry, outlet, event)
   *
   * Sends a table-confirmed or cancellation message.
   * These are event-driven and NOT counted toward the notifications_sent cap.
   *
   * @param {object} entry
   * @param {object} outlet — outlet config object
   * @param {string} event  — 'seat' | 'cancel'
   */
  static async sendEventMessage(entry, outlet, event) {
    let text;

    if (event === 'seat') {
      text = WhatsAppService.buildTableConfirmedMessage(outlet.name, entry.party_size);
    } else if (event === 'cancel') {
      text = WhatsAppService.buildCancellationMessage(outlet.name);
    } else {
      console.warn('[Notifier] Unknown event type:', event);
      return;
    }

    await Notifier.dispatchNotification(
      entry, outlet, 0 /* updateNum=0 for events */, text, false
    );
  }

  /**
   * logNotification(entryId, updateNum, status, errorMessage)
   *
   * Inserts a row into notification_log.
   * Called by dispatchNotification on both success and failure.
   *
   * @param {string} entryId
   * @param {number} updateNum
   * @param {string} status       — 'sent' | 'failed'
   * @param {string} [errorMessage]
   */
  static async logNotification(entryId, updateNum, status, errorMessage = null) {
    const { error } = await supabase.from('notification_log').insert({
      queue_entry_id: entryId,
      update_number:  updateNum,
      status,
      error_message:  errorMessage,
    });

    if (error) {
      // Non-critical — log locally but don't throw
      console.error('[Notifier] Failed to write notification_log:', error);
    }
  }

  /**
   * _incrementNotificationCount(entryId) — private
   *
   * Fetches the current notifications_sent for the session linked
   * to this entry and increments by 1. Straightforward fetch-then-update
   * since Supabase RPC may not be set up.
   *
   * @param {string} entryId
   */
  static async _incrementNotificationCount(entryId) {
    const { data: session } = await supabase
      .from('wa_sessions')
      .select('phone, notifications_sent')
      .eq('queue_entry_id', entryId)
      .single();

    if (!session) return;

    await supabase
      .from('wa_sessions')
      .update({ notifications_sent: session.notifications_sent + 1 })
      .eq('phone', session.phone);
  }

  /**
   * _getOutletSlug(outletId) — private
   *
   * Fetches outlet slug from Supabase by uuid.
   * Used to look up the outlet config object from ConfigLoader.
   *
   * @param   {string} outletId — uuid
   * @returns {string} slug
   */
  static async _getOutletSlug(outletId) {
    const { data } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', outletId)
      .single();
    return data?.slug;
  }
}

export default Notifier;