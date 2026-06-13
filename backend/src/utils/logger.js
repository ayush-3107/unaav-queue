// src/utils/logger.js
//
// Morgan-based HTTP request logger.
// In production: phone numbers are masked in log output to protect customer PII.
// In development: full output for easier debugging.

import morgan from 'morgan';

const IS_PROD = process.env.NODE_ENV === 'production';

// Mask Indian mobile numbers (10-digit) and numbers with country code (+91xxxxxxxxxx)
// in any log token output.
function maskPhoneNumbers(str) {
  if (!str) return str;
  return str
    .replace(/\+91\d{10}/g, '+91**REDACTED**')
    .replace(/\b[6-9]\d{9}\b/g, '**REDACTED**');
}

// Custom Morgan token that masks phone numbers in the URL
morgan.token('masked-url', (req) => {
  return IS_PROD ? maskPhoneNumbers(req.originalUrl) : req.originalUrl;
});

// Custom token for request body summary (webhook debugging in dev only)
morgan.token('body-summary', (req) => {
  if (IS_PROD) return '';
  if (!req.body || typeof req.body !== 'object') return '';
  const summary = JSON.stringify(req.body).slice(0, 120);
  return summary.length === 120 ? summary + '...' : summary;
});

const format = IS_PROD
  ? ':method :masked-url :status :res[content-length] - :response-time ms'
  : ':method :masked-url :status :response-time ms :body-summary';

const logger = morgan(format);

export default logger;