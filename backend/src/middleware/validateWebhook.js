// src/middleware/validateWebhook.js
//
// Verifies the X-Hub-Signature-256 header on every POST /webhook request.
// Meta signs the raw request body using HMAC-SHA256 with your
// WHATSAPP_ACCESS_TOKEN as the key. We recompute the signature and
// compare using timingSafeEqual to prevent timing attacks.
//
// If the signature is missing or doesn't match → 403 Forbidden.
// This prevents anyone other than Meta from posting to your webhook.

import crypto from 'crypto';

function validateWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];

  // If no signature header present — reject immediately
  if (!signature) {
    console.warn('[validateWebhook] Missing X-Hub-Signature-256 header.');
    return res.sendStatus(403);
  }

  // req.body is the raw Buffer (express.raw() is applied to /webhook in index.js)
  const rawBody = req.body;

  if (!rawBody || rawBody.length === 0) {
    console.warn('[validateWebhook] Empty request body.');
    return res.sendStatus(400);
  }

  // Compute expected signature
  const expected = 'sha256=' +
    crypto
      .createHmac('sha256', process.env.WHATSAPP_ACCESS_TOKEN)
      .update(rawBody)
      .digest('hex');

  // Compare using timingSafeEqual to prevent timing side-channel attacks
  try {
    const sigBuffer      = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      console.warn('[validateWebhook] Signature mismatch — request rejected.');
      return res.sendStatus(403);
    }
  } catch {
    return res.sendStatus(403);
  }

  // Signature valid — parse body as JSON and attach to req.body
  // (replaces the raw Buffer with the parsed object for downstream handlers)
  try {
    req.body = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    console.warn('[validateWebhook] Failed to parse webhook body as JSON.');
    return res.sendStatus(400);
  }

  next();
}

export default validateWebhook;