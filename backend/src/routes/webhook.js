// src/routes/webhook.js
//
// Two routes:
//   GET  /webhook  — Meta verification handshake (one-time setup)
//   POST /webhook  — Receive all incoming WhatsApp messages

import { Router }      from 'express';
import validateWebhook from '../middleware/validateWebhook.js';
import StateMachine    from '../services/StateMachine.js';

const router = Router();

// ── GET /webhook ──────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('[Webhook] Verification handshake successful.');
    return res.status(200).send(challenge);
  }

  console.warn('[Webhook] Verification failed — token mismatch or wrong mode.');
  return res.sendStatus(403);
});

// ── POST /webhook ─────────────────────────────────────────────────────────────
router.post('/', validateWebhook, (req, res) => {
  // Always return 200 immediately — Meta retries if no response within 5s
  res.sendStatus(200);

  // Extract message from Meta payload
  const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  // Ignore non-message events (delivery receipts, read receipts, status updates)
  if (!message) return;

  // Process asynchronously — must not block the response
  setImmediate(async () => {
    try {
      await StateMachine.handleIncomingMessage(message);
    } catch (err) {
      // Log but do not crash the process — Meta would retry and cause duplicates
      console.error('[Webhook] StateMachine error:', err.message);
    }
  });
});

export default router;