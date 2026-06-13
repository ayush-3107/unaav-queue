// src/routes/auth.js
//
// POST /api/auth/login
//
// Validates manager credentials against outlets.config.json.
// On success: returns a JWT + outlet info for the frontend to store in memory.
// On failure: returns 401.

import { Router }   from 'express';
import AuthService  from '../services/AuthService.js';
import supabase     from '../utils/supabaseClient.js';

const router = Router();

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body ?? {};

  // Basic input validation
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required.' });
  }

  // Validate against config file
  const outlet = AuthService.validateCredentials(username, password);
  if (!outlet) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Fetch the outlet's Supabase row to get its uuid
  // (config has slug, DB has the uuid we need for all queries)
  const { data: outletRow, error: dbError } = await supabase
    .from('outlets')
    .select('id, name, slug')
    .eq('slug', outlet.slug)
    .single();

  if (dbError || !outletRow) {
    console.error('[Auth] Outlet not found in DB for slug:', outlet.slug, dbError);
    return res.status(500).json({ error: 'Outlet configuration error.' });
  }

  // Generate JWT
  const token = AuthService.generateToken(username, outletRow.id, outletRow.slug);

  console.log(`[Auth] Manager logged in: ${username} → ${outletRow.name}`);

  return res.status(200).json({
    token,
    username,
    outlet_id:   outletRow.id,
    outlet_name: outletRow.name,
    slug:        outletRow.slug,
  });
});

export default router;