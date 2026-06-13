// src/apiClient.js
//
// Axios instance for all Express backend API calls.
// Automatically attaches JWT from AuthContext to every request.
// Redirects to /login on 401 responses.

import axios from 'axios';

// In dev: Vite proxy forwards /api → localhost:3000
// In prod: VITE_API_BASE_URL points to Render URL
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 10000,
});

// ── Token accessor ────────────────────────────────────────────────────────────
// AuthContext stores the token in a module-level variable so the
// Axios interceptor can read it without needing React context directly.
let _token = null;

export function setApiToken(token) { _token = token; }
export function clearApiToken()    { _token = null;  }

// ── Request interceptor — attach JWT ─────────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  if (_token) {
    config.headers.Authorization = `Bearer ${_token}`;
  }
  return config;
});

// ── Response interceptor — handle 401 ────────────────────────────────────────
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or invalid — clear and redirect to login
      clearApiToken();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;