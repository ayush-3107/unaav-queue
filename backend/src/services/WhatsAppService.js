// src/services/WhatsAppService.js
//
// All WhatsApp communication via Snapto API.
// Endpoint: POST https://app.snapto.ai/api/v1/whatsapp/sendMessage
//
// Template map (exact Snapto names → variables):
//
// queue_welcome_template          {{1}}=outlet
// queue_confirmation_template     {{1}}=position, {{2}}=outlet, {{3}}=wait
// queue_update_position_template  {{1}}=outlet, {{2}}=position, {{3}}=wait
// queue_almost_ready_template     {{1}}=position, {{2}}=outlet
// queue_table_confirmed_template  {{1}}=party_size, {{2}}=outlet
// queue_cancelled_template        {{1}}=outlet
// cancellation_by_manager         {{1}}=customer name, {{2}}=outlet
// large_party_template            {{1}}=customer name
// queue_review_request            {{1}}=customer name, {{2}}=outlet
// queue_review_positive           {{1}}=customer name, {{2}}=outlet
// queue_review_negative           {{1}}=customer name (Flow button attached)
// queue_review_thanks             {{1}}=customer name

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

  // ── Queue flow send methods ─────────────────────────────────────────────────

  static async sendWelcome(to, outletName) {
    return WhatsAppService._post({
      templateName:      'queue_welcome_template',
      language:          'en',
      to,
      templateVariables: [outletName],
    });
  }

  static async sendConfirmation(to, customerName, outletName, position, waitMins) {
    return WhatsAppService._post({
      templateName:      'queue_confirmation_template',
      language:          'en',
      to,
      templateVariables: [
        String(position),
        outletName,
        String(waitMins),
      ],
    });
  }

  static async sendPositionUpdate(to, customerName, outletName, position, waitMins) {
    return WhatsAppService._post({
      templateName:      'queue_update_position_template',
      language:          'en',
      to,
      templateVariables: [
        outletName,
        String(position),
        String(waitMins),
      ],
    });
  }

  static async sendAlmostReady(to, customerName, outletName, position) {
    return WhatsAppService._post({
      templateName:      'queue_almost_ready_template',
      language:          'en',
      to,
      templateVariables: [
        String(position),
        outletName,
      ],
    });
  }

  static async sendTableConfirmed(to, customerName, outletName, partySize) {
    return WhatsAppService._post({
      templateName:      'queue_table_confirmed_template',
      language:          'en',
      to,
      templateVariables: [
        String(partySize),
        outletName,
      ],
    });
  }

  static async sendCancelled(to, customerName, outletName) {
    return WhatsAppService._post({
      templateName:      'queue_cancelled_template',
      language:          'en',
      to,
      templateVariables: [outletName],
    });
  }

  static async sendDeletedByManager(to, customerName, outletName) {
    return WhatsAppService._post({
      templateName:      'cancellation_by_manager_template',
      language:          'en',
      to,
      templateVariables: [
        customerName || 'Guest',
        outletName,
      ],
    });
  }

  static async sendLargePartyPrompt(to, customerName) {
    return WhatsAppService._post({
      templateName:      'large_party_template',
      language:          'en',
      to,
      templateVariables: [customerName || 'there'],
    });
  }

  // ── Review system send methods ──────────────────────────────────────────────

  /**
   * sendReviewRequest(to, customerName, outletName)
   *
   * Sent 90 minutes after table confirmation (via cron job).
   * Template: review_request_template
   * Buttons (Quick Reply): "5 Star" | "4 Star" | "3 Star or less"
   *
   * Message:
   *   "Hi {{1}}, Thank you for dining with us at {{2}}! 🌟
   *    Please take a moment to rate your experience. We truly appreciate your time!"
   *
   * Params: {{1}}=customer name, {{2}}=outlet
   */
  static async sendReviewRequest(to, customerName, outletName) {
    return WhatsAppService._post({
      templateName:      'review_request_template',
      language:          'en',
      to,
      templateVariables: [
        customerName || 'Guest',
        outletName,
      ],
    });
  }

  /**
   * sendReviewPositive(to, customerName, outletName)
   *
   * Sent when customer taps "5 Star" or "4 Star".
   * Template: review_positive_template
   *
   * Params: {{1}}=customer name, {{2}}=outlet
   */
  static async sendReviewPositive(to, customerName, outletName) {
    return WhatsAppService._post({
      templateName:      'review_positive_template',
      language:          'en',
      to,
      templateVariables: [
        customerName || 'Guest',
        outletName,
      ],
    });
  }

  /**
   * sendReviewNegative(to, customerName)
   *
   * Sent when customer taps "3 Star or less".
   * Template: review_negative_template
   * Has a Flow-type button ("Show More Details") attached in Snapto
   * which opens the native multi-screen feedback form.
   *
   * Params: {{1}}=customer name
   */
  static async sendReviewNegative(to, customerName) {
    return WhatsAppService._post({
      templateName:      'review_negative_template',
      language:          'en',
      to,
      templateVariables: [customerName || 'Guest'],
    });
  }

  /**
   * sendReviewThankYou(to, customerName)
   *
   * Sent after customer completes the feedback Flow.
   * Template: review_feedback_received_template
   *
   * Params: {{1}}=customer name
   */
  static async sendReviewThankYou(to, customerName) {
    return WhatsAppService._post({
      templateName:      'review_feedback_received_template',
      language:          'en',
      to,
      templateVariables: [customerName || 'Guest'],
    });
  }

  // ── Input parsers ─────────────────────────────────────────────────────────

  /**
   * parsePartySize(text)
   * Parses party size from plain text reply ('3', '10', etc.)
   * Returns integer 1-20 or null.
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
   * Returns true for "Cancel Reservation" button tap or "CANCEL" text.
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
   * parseStarRating(text)
   *
   * Parses the customer's reply to queue_review_request.
   * Buttons are: "5 Star" | "4 Star" | "3 Star or less"
   *
   * Returns:
   *   5   → customer tapped "5 Star"
   *   4   → customer tapped "4 Star"
   *   3   → customer tapped "3 Star or less" (treated as the negative-flow trigger)
   *   null → not a recognised rating reply
   *
   * Note: "3 Star or less" is mapped to 3 specifically so downstream logic
   * `starRating >= 4` correctly routes it to the negative/feedback-form path.
   */
  static parseStarRating(text) {
    if (!text) return null;
    const n = text.trim().toUpperCase();

    if (n === '5 STAR' || n === '5') return 5;
    if (n === '4 STAR' || n === '4') return 4;
    if (n.includes('3 STAR OR LESS') || n === '3') return 3;

    return null;
  }

  static async fetchProfileName(_phone) {
    return null;
  }
}

export default WhatsAppService;