// src/services/Notifier.js

import supabase         from '../utils/supabaseClient.js';
import QueueEngine      from './QueueEngine.js';
import WhatsAppService  from './WhatsAppService.js';
import ConfigLoader     from './ConfigLoader.js';

class Notifier {

  /**
   * checkAndNotify(entryId)
   * Called after every recalculatePositions().
   * Sends Update #2 or #3 if threshold is met.
   */
  static async checkAndNotify(entryId) {
    const entry = await QueueEngine.getEntryById(entryId);
    if (!entry || entry.status !== 'waiting') return;

    const { data: session } = await supabase
      .from('wa_sessions')
      .select('notifications_sent, phone')
      .eq('queue_entry_id', entryId)
      .single();

    if (!session) return;
    if (session.notifications_sent >= 3) return;

    const { data: outletRow } = await supabase
      .from('outlets')
      .select('slug')
      .eq('id', entry.outlet_id)
      .single();

    const outlet = ConfigLoader.getInstance().getOutletBySlug(outletRow?.slug);
    if (!outlet) return;

    const remainingWait = QueueEngine.calculateWaitTime(outlet, entry.position);

    // ── Update #2 ──────────────────────────────────────────────────────────
    if (
      session.notifications_sent === 1 &&
      Notifier._shouldSendUpdate(entry, 2)
    ) {
      await Notifier.dispatchNotification(entry, outlet, session, 2, remainingWait);
      return;
    }

    // ── Update #3 ──────────────────────────────────────────────────────────
    if (
      session.notifications_sent === 2 &&
      Notifier._shouldSendUpdate(entry, 3)
    ) {
      await Notifier.dispatchNotification(entry, outlet, session, 3, remainingWait);
    }
  }

  static _shouldSendUpdate(entry, updateNumber) {
    const { position, initial_position } = entry;
    if (updateNumber === 2) return position <= Math.floor(initial_position / 2);
    if (updateNumber === 3) return position <= 2;
    return false;
  }

  /**
   * dispatchNotification(entry, outlet, session, updateNum, remainingWait)
   */
  static async dispatchNotification(entry, outlet, session, updateNum, remainingWait) {
    const customerName = entry.customer_name ?? 'Guest';

    try {
      if (updateNum === 2) {
        await WhatsAppService.sendPositionUpdate(
          entry.phone, customerName, outlet.name,
          entry.position, remainingWait
        );
      } else if (updateNum === 3) {
        await WhatsAppService.sendAlmostReady(
          entry.phone, customerName, outlet.name,
          entry.position
        );
      }

      await Notifier.logNotification(entry.id, updateNum, 'sent');
      await Notifier._incrementNotificationCount(entry.phone, session);

      console.log(
        `[Notifier] Update #${updateNum} sent to ${entry.phone} ` +
        `(position ${entry.position})`
      );
    } catch (err) {
      console.error(`[Notifier] Failed update #${updateNum}:`, err.message);
      await Notifier.logNotification(entry.id, updateNum, 'failed', err.message);
    }
  }

  /**
   * sendEventMessage(entry, outlet, event)
   *
   * Event-driven messages — not counted toward notifications_sent cap.
   * Events: 'seat' | 'cancel' | 'delete'
   */
  static async sendEventMessage(entry, outlet, event) {
    const customerName = entry.customer_name ?? 'Guest';

    try {
      if (event === 'seat') {
        await WhatsAppService.sendTableConfirmed(
          entry.phone, customerName, outlet.name, entry.party_size
        );
      } else if (event === 'cancel') {
        await WhatsAppService.sendCancelled(
          entry.phone, customerName, outlet.name
        );
      } else if (event === 'delete') {
        await WhatsAppService.sendDeletedByManager(
          entry.phone, customerName, outlet.name
        );
      } else {
        console.warn('[Notifier] Unknown event type:', event);
        return;
      }

      await Notifier.logNotification(entry.id, 0, 'sent');
      console.log(`[Notifier] Event "${event}" message sent to ${entry.phone}`);

    } catch (err) {
      console.error(`[Notifier] Failed event "${event}":`, err.message);
      await Notifier.logNotification(entry.id, 0, 'failed', err.message);
    }
  }

  static async logNotification(entryId, updateNum, status, errorMessage = null) {
    const { error } = await supabase.from('notification_log').insert({
      queue_entry_id: entryId,
      update_number:  updateNum,
      status,
      error_message:  errorMessage,
    });
    if (error) {
      console.error('[Notifier] Failed to write notification_log:', error);
    }
  }

  static async _incrementNotificationCount(phone, session) {
    await supabase
      .from('wa_sessions')
      .update({ notifications_sent: session.notifications_sent + 1 })
      .eq('phone', phone);
  }
}

export default Notifier;