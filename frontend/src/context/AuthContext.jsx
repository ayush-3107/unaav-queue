import { createContext, useContext, useState, useEffect } from 'react';
import { setApiToken, clearApiToken } from '../apiClient.js';

const AuthContext = createContext(null);

const STORAGE_KEY = 'unaav_auth';

export function AuthProvider({ children }) {
  const [auth, setAuthState] = useState(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (parsed?.token) setApiToken(parsed.token); // ← rehydrate Axios token too
      return parsed;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(false);
  }, []);

  function setAuth(newAuth) {
    setAuthState(newAuth);
    if (newAuth) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newAuth));
      setApiToken(newAuth.token); // ← wire token into Axios interceptor
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
      clearApiToken();
    }
  }

  function logout() {
    setAuth(null);
  }

  const ctx = { auth, setAuth, logout, loading };

  return (
    <AuthContext.Provider value={ctx}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  return useContext(AuthContext);
}