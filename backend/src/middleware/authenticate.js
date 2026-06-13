// src/middleware/authenticate.js
//
// JWT verification middleware for all protected API routes.
//
// Expects:  Authorization: Bearer <token>
// On success: attaches decoded payload to req.user and calls next()
// On failure: responds 401 Unauthorized
//
// req.user shape after successful verification:
//   { username: string, outlet_id: string, slug: string, iat: number, exp: number }

import AuthService from '../services/AuthService.js';

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed.' });
  }

  const token   = authHeader.slice(7); // Remove 'Bearer ' prefix
  const decoded = AuthService.verifyToken(token);

  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }

  // Attach manager identity to the request for downstream use
  req.user = decoded;
  next();
}

export default authenticate;