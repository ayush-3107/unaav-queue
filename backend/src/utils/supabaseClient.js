// src/utils/supabaseClient.js
//
// Single Supabase client instance for the entire backend.
// Uses the SERVICE ROLE KEY — bypasses RLS, full DB access.
// Never expose this key to the frontend.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    'Missing Supabase credentials. ' +
    'Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env'
  );
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    // Disable auto-refresh and session persistence on the backend.
    // The service role key does not use session-based auth.
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

export default supabase;