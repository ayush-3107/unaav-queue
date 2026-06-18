// index.js

import 'dotenv/config';
import express          from 'express';
import helmet           from 'helmet';
import cors             from 'cors';
import logger           from './src/utils/logger.js';
import ConfigLoader     from './src/services/ConfigLoader.js';
import webhookRouter    from './src/routes/webhook.js';
import authRouter       from './src/routes/auth.js';
import queueRouter      from './src/routes/queue.js';
import customersRouter  from './src/routes/customers.js';

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const OPTIONAL_ENV = [
  'JWT_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'SNAPTO_API_KEY',
  'SNAPTO_PHONE_ID',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error('[Startup] Missing required env vars:', missing.join(', '));
  process.exit(1);
}

const missingOptional = OPTIONAL_ENV.filter((k) => !process.env[k]);
if (missingOptional.length > 0) {
  console.warn('[Startup] Warning: Missing optional env vars:', missingOptional.join(', '));
}

// ── Load outlet config ────────────────────────────────────────────────────────
ConfigLoader.getInstance().load();

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin:         process.env.FRONTEND_URL || 'http://localhost:5173',
  methods:        ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(logger);

// JSON parser for ALL routes including /webhook
// Snapto sends JSON directly — no raw body needed
// (Raw body was only required for Meta direct HMAC verification)
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhook',       webhookRouter);
app.use('/api/auth',      authRouter);
app.use('/api/queue',     queueRouter);
app.use('/api/customers', customersRouter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status:      'ok',
    timestamp:   new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[GlobalError]', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  console.log(`[Server] Health: http://localhost:${PORT}/health`);
});

export default app;