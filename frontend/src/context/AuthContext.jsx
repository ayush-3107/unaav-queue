// src/context/AuthContext.jsx
//
// Stores manager authentication state in React memory.
// JWT is NEVER written to localStorage or sessionStorage.
// On page refresh auth is cleared — manager must log in again.
// This is intentional: eliminates XSS token theft risk.

import { createContext, useContext, useState, useCallback } from 'react';
import { setApiToken, clearApiToken } from '../apiClient.js';

const AuthContext = createContext(null);

// auth shape: { token, outlet_id, outlet_name, slug } | null

export function AuthProvider({ children }) {
    console.log("AuthProvider rendering");
  const [auth, setAuth] = useState(null);

  // Called after successful POST /api/auth/login
  const login = useCallback((data) => {
    setAuth(data);
    setApiToken(data.token); // wire token into Axios interceptor
  }, []);

  // Called on logout button or 401 response
  const logout = useCallback(() => {
    setAuth(null);
    clearApiToken();
  }, []);

  return (
    <AuthContext.Provider value={{ auth, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext() {
  const ctx = useContext(AuthContext);

  console.log("ctx =", ctx);

  if (!ctx) {
    throw new Error("useAuthContext must be used inside <AuthProvider>");
  }

  return ctx;
}