// src/hooks/useAuth.js

import { useAuthContext } from '../context/AuthContext.jsx';

export function useAuth() {
  const ctx = useAuthContext();
  return ctx;
}