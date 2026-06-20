// src/services/WhatsAppService.js
//
// All WhatsApp communication via Snapto API.
// Endpoint: POST https://app.snapto.ai/api/v1/whatsapp/sendMessage
//
// Template map (exact Snapto names → variables):
//
// queue_welcome_template          {{1}}=outlet
// queue_confirmation              {{1}}=position, {{2}}=outlet, {{3}}=wait
// queue_update_position           {{1}}=outlet, {{2}}=position, {{3}}=wait
// queue_almost_ready              {{1}}=position, {{2}}=outlet
// queue_table_confirmed           {{1}}=party_size, {{2}}=outlet
// queue_cancelled                 {{1}}=outlet

import axios from 'axios';

const SNAPTO_ENDPOINT = 'https://app.snapto.ai/api/v1/whatsapp/sendMessage';

class WhatsAppService {

  /**
   * _post(payload)
   * Core POST to Snapto API. All public methods call this.
   */
  static async _post(payload) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key':    process.env.SNAPTO_API_KEY,
      };

      if (process.env.SNAPTO_PHONE_ID) {
        headers['x-phone-id'] = process.env.SNAPTO_PHONE_ID;
      }

      const response = await axios.post(SNAPTO_ENDPOINT, payload, {
        headers,
        timeout: 10000,
      });

      console.log(
        `[WhatsAppService] ✓ Sent "${payload.templateName}" to ${payload.to} ` +
        `| params: [${payload.templateVariables?.join(', ')}]`
      );
      return response.data;

    } catch (err) {
      const detail = err.response?.data ?? err.message;
      console.error(
        `[WhatsAppService] ✗ Failed "${payload.templateName}" to ${payload.to}:`,
        JSON.stringify(detail)
      );
      throw new Error(`Snapto API error: ${JSON.stringify(detail)}`);
    }
  }

  // ── Send methods ──────────────────────────────────────────────────────────

  /**
   * sendWelcome(to, outletName)
   *
   * Sent when customer first messages the outlet.
   * Template: queue_welcome_template
   *
   * Message:
   *   "Hey there! 👋 Welcome to Unaav – The Dakshin Cafe ({{1}} outlet)..."
   *   "Just reply with a number — e.g. 3 for a table of 3"
   *
   * Params: {{1}} = outlet name
   */
  static async sendWelcome(to, outletName) {
    return WhatsAppService._post({
      templateName:      'queue_welcome_template',
      language:          'en',
      to,
      templateVariables: [outletName],
    });
  }

  /**
   * sendConfirmation(to, customerName, outletName, position, waitMins)
   *
   * Update #1 — sent immediately after customer joins queue.
   * Template: queue_confirmation
   *
   * Message:
   *   "You're in! 🎉 Consider your spot saved."
   *   "You're token #{{1}} at {{2}}, and we're looking at about a {{3}} minute wait."
   *   "Hang out, relax — we'll buzz you the second your table's ready! 🙌"
   *   [Cancel Reservation button]
   *
   * Params: {{1}}=position, {{2}}=outlet, {{3}}=wait
   */
  static async sendConfirmation(to, customerName, outletName, position, waitMins) {
    return WhatsAppService._post({
      templateName:      'queue_confirmation',
      language:          'en',
      to,
      templateVariables: [
        String(position),
        outletName,
        String(waitMins),
      ],
    });
  }

  /**
   * sendPositionUpdate(to, customerName, outletName, position, waitMins)
   *
   * Update #2 — sent when position drops to ~50% of initial.
   * Template: queue_update_position
   *
   * Message:
   *   "Hey, quick one from {{1}}! 🔔"
   *   "You've moved up — you're #{{2}} now, with roughly {{3}} minutes to go."
   *   [Cancel Reservation button]
   *
   * Params: {{1}}=outlet, {{2}}=position, {{3}}=wait
   * NOTE: outlet is FIRST for this template (different order from others)
   */
  static async sendPositionUpdate(to, customerName, outletName, position, waitMins) {
    return WhatsAppService._post({
      templateName:      'queue_update_position',
      language:          'en',
      to,
      templateVariables: [
        outletName,        // {{1}} = outlet (first for this template)
        String(position),  // {{2}} = position
        String(waitMins),  // {{3}} = wait
      ],
    });
  }

  /**
   * sendAlmostReady(to, customerName, outletName, position)
   *
   * Update #3 — sent when position reaches 2 or 3.
   * Template: queue_almost_ready
   *
   * Message:
   *   "Almost your turn — get ready! 🍽️"
   *   "You're #{{1}} in line at {{2}}. Start making your way to the entrance..."
   *   [Cancel Reservation button]
   *
   * Params: {{1}}=position, {{2}}=outlet
   */
  static async sendAlmostReady(to, customerName, outletName, position) {
    return WhatsAppService._post({
      templateName:      'queue_almost_ready',
      language:          'en',
      to,
      templateVariables: [
        String(position),  // {{1}} = position
        outletName,        // {{2}} = outlet
      ],
    });
  }

  /**
   * sendTableConfirmed(to, customerName, outletName, partySize)
   *
   * Sent when manager marks customer as seated (after confirming).
   * Template: queue_table_confirmed
   *
   * Message:
   *   "Your table's ready — come on in! 🎉"
   *   "We've got the perfect spot for your party of {{1}} at {{2}}."
   *   "Enjoy every bite! 😋🍽️"
   *
   * Params: {{1}}=party_size, {{2}}=outlet
   */
  static async sendTableConfirmed(to, customerName, outletName, partySize) {
    return WhatsAppService._post({
      templateName:      'queue_table_confirmed',
      language:          'en',
      to,
      templateVariables: [
        String(partySize), // {{1}} = party size
        outletName,        // {{2}} = outlet
      ],
    });
  }

  /**
   * sendCancelled(to, customerName, outletName)
   *
   * Sent when customer taps Cancel Reservation button.
   * Template: queue_cancelled
   *
   * Message:
   *   "All done — we've cancelled your spot at {{1}}. ✅"
   *   "No worries at all! Whenever that South Indian craving strikes..."
   *
   * Params: {{1}}=outlet
   */
  static async sendCancelled(to, customerName, outletName) {
    return WhatsAppService._post({
      templateName:      'queue_cancelled',
      language:          'en',
      to,
      templateVariables: [outletName],
    });
  }

  // ── Input parsers ─────────────────────────────────────────────────────────

  /**
   * parsePartySize(text)
   *
   * Parses party size from plain text reply.
   * Customer types '3', '5', '10' etc. in response to queue_welcome_template.
   * Returns integer 1-20 or null if not parseable.
   */
  static parsePartySize(text) {
    if (!text) return null;
    const match = text.trim().match(/^(\d+)/);
    if (!match) return null;
    const size = parseInt(match[1], 10);
    if (size < 1 || size > 20) return null;
    return size;
  }

  /**
   * isCancelMessage(text)
   *
   * Returns true if customer tapped Cancel Reservation button
   * or typed CANCEL as plain text.
   *
   * Snapto sends button taps as: msg.button.text = "Cancel Reservation"
   */
  static isCancelMessage(text) {
    if (!text) return false;
    const n = text.trim().toUpperCase();
    return (
      n === 'CANCEL'                   ||
      n.includes('CANCEL RESERVATION') ||
      n.includes('❌')
    );
  }

  /**
   * sendDeletedByManager(to, customerName, outletName)
   *
   * Sent when manager deletes a customer entry from the dashboard.
   * Template: cancellation_by_manager
   *
   * Message:
   *   "Aw, sorry to see you go, {{1}}! 😔"
   *   "Your spot at {{2}} has been removed..."
   *
   * Params: {{1}}=customer name, {{2}}=outlet
   */
  static async sendDeletedByManager(to, customerName, outletName) {
    return WhatsAppService._post({
      templateName:      'cancellation_by_manager',
      language:          'en',
      to,
      templateVariables: [
        customerName || 'Guest',
        outletName,
      ],
    });
  }

  /**
   * sendLargePartyPrompt(to, customerName)
   *
   * Sent when customer taps "10+" on the welcome message.
   * Template: queue_large_party
   * Quick Reply buttons: 10-19
   *
   * Params: {{1}} = customer name
   */
  static async sendLargePartyPrompt(to, customerName) {
    return WhatsAppService._post({
      templateName:      'large_party_template',
      language:          'en',
      to,
      templateVariables: [customerName || 'there'],
    });
  }

  static async fetchProfileName(_phone) {
    return null;
  }
}

export default WhatsAppService;