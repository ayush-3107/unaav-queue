// src/components/ProtectedRoute.jsx
//
// Guards routes that require a logged-in manager.
// Waits for AuthContext to finish rehydrating from sessionStorage
// before deciding to redirect — prevents flashing the login page
// on every refresh.

import { Navigate } from 'react-router-dom';
import { useAuth }  from '../hooks/useAuth.js';

export default function ProtectedRoute({ children }) {
  console.log('ProtectedRoute render');
  const { auth, loading } = useAuth();

  console.log('auth =', auth);

  // Still rehydrating from sessionStorage — render nothing yet
  // (prevents redirect flash before auth is restored)
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-sm text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!auth) {
    return <Navigate to="/login" replace />;
  }

  return children;
}