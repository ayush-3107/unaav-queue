// index.js
//
// Express application entry point.
// Responsibilities:
//   - Load environment variables
//   - Initialise ConfigLoader (read outlets.config.json)
//   - Register middleware
//   - Mount routes
//   - Start HTTP server

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

// ── Validate required environment variables ───────────────────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

const OPTIONAL_ENV = [
  'JWT_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_ACCESS_TOKEN',
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    '[Startup] Missing required environment variables:',
    missing.join(', ')
  );
  process.exit(1);
}

const missingOptional = OPTIONAL_ENV.filter((key) => !process.env[key]);
if (missingOptional.length > 0) {
  console.warn(
    '[Startup] Warning: Missing optional environment variables:',
    missingOptional.join(', ')
  );
}

// ── Load outlet configuration ─────────────────────────────────────────────────
// Must happen before any route handler runs — services depend on this cache.
ConfigLoader.getInstance().load();

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();

// ── Middleware (order matters) ────────────────────────────────────────────────

// Security headers
app.use(helmet());

// CORS — allow only the configured frontend origin
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// HTTP request logging
app.use(logger);

// Raw body parser for /webhook — MUST come before express.json()
// Meta webhook signature verification requires the raw bytes.
app.use(
  '/webhook',
  express.raw({ type: 'application/json' })
);

// JSON body parser for all other routes
app.use(express.json());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/webhook',       webhookRouter);
app.use('/api/auth',      authRouter);
app.use('/api/queue',     queueRouter);
app.use('/api/customers', customersRouter);

// ── Health check ──────────────────────────────────────────────────────────────
// UptimeRobot pings this every 5 minutes to keep Render from sleeping.
// No auth required — returns minimal JSON.
app.get('/health', (_req, res) => {
  res.status(200).json({
    status:      'ok',
    timestamp:   new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ── Global error handler ──────────────────────────────────────────────────────
// Catches any unhandled errors thrown in route handlers.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[GlobalError]', err);
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error.'
      : err.message,
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT, 10) || 3000;

app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
});

export default app;