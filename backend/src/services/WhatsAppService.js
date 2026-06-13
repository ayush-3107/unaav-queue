// src/services/WhatsAppService.js
//
// All Meta WhatsApp Cloud API communication.
// Base URL: https://graph.facebook.com/v19.0/{phoneNumberId}/messages
//
// All messages are SESSION messages — no templates needed since all
// communication happens within 2–3 hours of the customer's first message,
// well within the 24-hour WhatsApp session window.
//
// Message types used:
//   sendInteractiveList   — party size selection (1–10+)
//   sendInteractiveButton — queue updates with Cancel button
//   sendText              — table confirmed, cancellation, fallback replies

import axios from 'axios';

const BASE_URL = 'https://graph.facebook.com/v19.0';

class WhatsAppService {
  /**
   * _post(phoneNumberId, payload)
   *
   * Private. Core Axios POST to Meta Graph API.
   * All public send methods call this.
   *
   * @param   {string} phoneNumberId — from outlet config
   * @param   {object} payload       — message payload
   * @returns {object}               — Meta API response data
   */
  static async _post(phoneNumberId, payload) {
    const url = `${BASE_URL}/${phoneNumberId}/messages`;

    try {
      const response = await axios.post(url, payload, {
        headers: {
          Authorization:  `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      });
      return response.data;
    } catch (err) {
      const detail = err.response?.data ?? err.message;
      console.error('[WhatsAppService] API call failed:', JSON.stringify(detail));
      throw new Error(`WhatsApp API error: ${JSON.stringify(detail)}`);
    }
  }

  /**
   * sendInteractiveList(to, phoneNumberId, bodyText, sections)
   *
   * Sends an interactive list message — used for party size selection.
   * Renders as a tappable list in WhatsApp.
   *
   * @param {string}   to            — customer phone with country code e.g. +919810012345
   * @param {string}   phoneNumberId — from outlet config
   * @param {string}   bodyText      — main message text
   * @param {object[]} sections      — [{ title: string, rows: [{ id, title, description? }] }]
   */
  static async sendInteractiveList(to, phoneNumberId, bodyText, sections) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button:   'Select party size',
          sections,
        },
      },
    };

    return WhatsAppService._post(phoneNumberId, payload);
  }

  /**
   * sendInteractiveButton(to, phoneNumberId, bodyText, buttons)
   *
   * Sends an interactive button message — used for queue updates
   * that include the Cancel My Reservation button.
   *
   * WhatsApp supports max 3 buttons per message.
   *
   * @param {string}   to
   * @param {string}   phoneNumberId
   * @param {string}   bodyText
   * @param {object[]} buttons — [{ id: string, title: string }]
   */
  static async sendInteractiveButton(to, phoneNumberId, bodyText, buttons) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((btn) => ({
            type:  'reply',
            reply: { id: btn.id, title: btn.title },
          })),
        },
      },
    };

    return WhatsAppService._post(phoneNumberId, payload);
  }

  /**
   * sendText(to, phoneNumberId, text)
   *
   * Sends a plain text message.
   * Used for: table confirmed, cancellation confirmation, fallback replies.
   *
   * @param {string} to
   * @param {string} phoneNumberId
   * @param {string} text
   */
  static async sendText(to, phoneNumberId, text) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      type: 'text',
      text: {
        body:        text,
        preview_url: false,
      },
    };

    return WhatsAppService._post(phoneNumberId, payload);
  }

  /**
   * fetchProfileName(phone, accessToken)
   *
   * Attempts to retrieve the customer's WhatsApp display name
   * via the Meta Contacts API.
   * Returns null if unavailable (permission not granted, API error, etc.)
   *
   * @param   {string}        phone       — customer phone with country code
   * @param   {string}        accessToken — WHATSAPP_ACCESS_TOKEN
   * @returns {string|null}
   */
  static async fetchProfileName(phone) {
    try {
      const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
      if (!wabaId) return null;

      const url = `${BASE_URL}/${wabaId}/contacts`;
      const response = await axios.get(url, {
        params:  { phone_number: phone },
        headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      });

      return response.data?.contacts?.[0]?.profile?.name ?? null;
    } catch {
      // Non-critical — fall back to null silently
      return null;
    }
  }

  // ── Message content builders ─────────────────────────────────────────────────
  // Centralised message text so copy changes don't require touching service logic.

  /**
   * buildPartySizeList(outletName, maxPartySize)
   *
   * Builds the sections array for the party size interactive list.
   * Sizes 1 through maxPartySize, with the last shown as "10+".
   *
   * @param   {string} outletName
   * @param   {number} maxPartySize — from outlet config
   * @returns {{ bodyText: string, sections: object[] }}
   */
  static buildPartySizeList(outletName, maxPartySize) {
    const rows = [];
    for (let i = 1; i <= maxPartySize; i++) {
      const isLast  = i === maxPartySize;
      const label   = isLast ? `${i}+` : `${i}`;
      rows.push({
        id:    String(i),
        title: `${label} ${i === 1 ? 'person' : 'people'}`,
      });
    }

    return {
      bodyText: `Namaste! Welcome to ${outletName} 🙏\n\nTo confirm your spot in the queue, please select your party size:`,
      sections: [{ title: 'Number of guests', rows }],
    };
  }

  /**
   * buildConfirmationMessage(outletName, position, estimatedWaitMins)
   * Update #1 — sent immediately after joining the queue.
   */
  static buildConfirmationMessage(outletName, position, estimatedWaitMins) {
    return (
      `✅ You're confirmed!\n\n` +
      `You are *#${position}* in queue at ${outletName}.\n` +
      `Estimated wait: *~${estimatedWaitMins} mins*.\n\n` +
      `We'll send you updates as the queue moves.\n` +
      `No need to wait at the entrance — we'll notify you here! 🙏`
    );
  }

  /**
   * buildMidQueueMessage(position, remainingWaitMins)
   * Update #2 — sent when position drops to ~50% of initial.
   */
  static buildMidQueueMessage(position, remainingWaitMins) {
    return (
      `🔔 *Queue Update*\n\n` +
      `You are now *#${position}* in line.\n` +
      `Approx *${remainingWaitMins} mins* remaining.`
    );
  }

  /**
   * buildAlmostReadyMessage(position)
   * Update #3 — sent when position reaches 2 or 3.
   */
  static buildAlmostReadyMessage(position) {
    return (
      `⏳ *Almost your turn!*\n\n` +
      `You're *#${position}* in line — please start making your way to the entrance.\n` +
      `See you soon! 🙏`
    );
  }

  /**
   * buildTableConfirmedMessage(outletName, partySize)
   * Sent when manager marks customer as seated (after confirming).
   */
  static buildTableConfirmedMessage(outletName, partySize) {
    return (
      `✅ *Your table is confirmed!*\n\n` +
      `Welcome in! Your party of *${partySize}* will be seated shortly.\n` +
      `Enjoy your meal at ${outletName}! 🍛`
    );
  }

  /**
   * buildCancellationMessage(outletName)
   * Sent when customer taps Cancel My Reservation.
   */
  static buildCancellationMessage(outletName) {
    return (
      `Your reservation at *${outletName}* has been cancelled. ✅\n\n` +
      `We hope to see you soon! 🙏`
    );
  }

  /**
   * buildUnknownMessage()
   * Fallback reply for unrecognised messages.
   */
  static buildUnknownMessage() {
    return `Please scan the QR code at our entrance to join the queue.`;
  }

  /**
   * buildActiveQueueReminderMessage(position)
   * Sent if customer sends a random message while already in queue.
   */
  static buildActiveQueueReminderMessage(position) {
    return (
      `Your reservation is active — you are *#${position}* in queue.\n\n` +
      `To cancel, tap the *Cancel My Reservation* button in your last update message.`
    );
  }

  // Cancel button definition — reused across all update messages
  static get CANCEL_BUTTON() {
    return [{ id: 'cancel', title: '❌ Cancel My Reservation' }];
  }
}

export default WhatsAppService;