// src/hooks/useAuth.js
//
// Convenience hook. Components use this instead of
// importing useAuthContext directly from the context file.

import { useAuthContext } from '../context/AuthContext.jsx';

export function useAuth() {
  return useAuthContext();
}