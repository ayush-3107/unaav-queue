// src/services/AuthService.js
//
// Handles manager authentication and JWT lifecycle.
// Credentials are validated against outlets.config.json (plain text passwords).
// JWTs are signed with JWT_SECRET and expire after 8 hours.

import jwt          from 'jsonwebtoken';
import ConfigLoader from './ConfigLoader.js';

// JWT expiry — 8 hours is sufficient for a full restaurant shift
const TOKEN_EXPIRY = '8h';

class AuthService {
  /**
   * validateCredentials(username, password)
   *
   * Looks up the manager in config. If found, compares passwords directly.
   * Returns the outlet object the manager belongs to, or null on failure.
   *
   * @param   {string}       username
   * @param   {string}       password
   * @returns {object|null}  outlet config object or null
   */
  static validateCredentials(username, password) {
    if (!username || !password) return null;

    const loader  = ConfigLoader.getInstance();
    const outlet  = loader.getManagerOutlet(username);
    if (!outlet) return null;

    const manager = outlet.managers.find((m) => m.username === username);
    if (!manager) return null;

    // Direct string comparison — passwords stored as plain text in config
    if (manager.password !== password) return null;

    return outlet;
  }

  /**
   * generateToken(username, outletId, slug)
   *
   * Signs a JWT containing the manager's identity and outlet scope.
   * This token is sent to the frontend and attached to every API request.
   *
   * @param   {string} username
   * @param   {string} outletId   — Supabase outlets.id (uuid)
   * @param   {string} slug       — outlet slug e.g. 'dwarka'
   * @returns {string}            — signed JWT
   */
  static generateToken(username, outletId, slug) {
    const payload = { username, outlet_id: outletId, slug };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: TOKEN_EXPIRY,
    });
  }

  /**
   * verifyToken(token)
   *
   * Verifies and decodes a JWT.
   * Returns the decoded payload or null if invalid / expired.
   *
   * @param   {string}       token
   * @returns {object|null}  decoded payload { username, outlet_id, slug } or null
   */
  static verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return null;
    }
  }
}

export default AuthService;