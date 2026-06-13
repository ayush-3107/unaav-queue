// src/supabaseClient.js
//
// Supabase client for the frontend.
// Uses the PUBLIC ANON KEY — safe to expose in the browser.
// RLS policies (when enabled) control what this key can access.
// Used only for: Realtime subscriptions.

import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error(
    'Missing Supabase env vars. ' +
    'Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in .env.local'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnon);