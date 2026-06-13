// src/components/ProtectedRoute.jsx
//
// Wraps any route that requires authentication.
// Redirects to /login if auth is null (not logged in).

import { Navigate } from 'react-router-dom';
import { useAuth }  from '../hooks/useAuth.js';

// ProtectedRoute.jsx
export default function ProtectedRoute({ children }) {
  console.log("ProtectedRoute render");

  const { auth } = useAuth();

  console.log("auth =", auth);

  return auth ? children : <Navigate to="/login" replace />;
}