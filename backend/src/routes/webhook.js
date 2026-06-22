// src/routes/webhook.js
//
// Snapto delivers messages in standard Meta webhook format.
// Customer profile name is available in contacts[0].profile.name

import { Router }   from 'express';
import StateMachine from '../services/StateMachine.js';

const router = Router();

// ── GET /webhook — verification handshake ────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verification successful.');
    return res.status(200).send(challenge);
  }

  return res.status(200).json({ status: 'ok' });
});

// ── POST /webhook — incoming messages ────────────────────────────────────────
router.post('/', (req, res) => {
  // Always return 200 immediately
  res.sendStatus(200);

  const value =
    req.body?.entry?.[0]?.changes?.[0]?.value;

  if (!value) return;

  const message  = value.messages?.[0];
  if (!message) {
    console.log('[Webhook] No message — status update, ignoring.');
    return;
  }

  // Extract customer profile name from contacts array
  // Snapto/Meta provides this on every incoming message
  const customerName =
    value.contacts?.[0]?.profile?.name ?? null;

  console.log(
    `[Webhook] Message from ${message.from}: ` +
    `"${message.text?.body ?? message.button?.text ?? message.interactive?.type ?? '[non-text]'}" ` +
    `| Name: ${customerName ?? 'unknown'}`
  );

  // Log Flow completion payloads for debugging
  if (message.interactive?.type === 'nfm_reply') {
    console.log('[Webhook] NFM Reply full payload:', JSON.stringify(message.interactive, null, 2));
  }

  // Attach customerName to message object so StateMachine can use it
  message._customerName = customerName;

  setImmediate(async () => {
    try {
      await StateMachine.handleIncomingMessage(message);
    } catch (err) {
      console.error('[Webhook] StateMachine error:', err.message);
    }
  });
});

export default router;