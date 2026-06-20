// src/pages/LoginPage.jsx
import { useState }       from 'react';
import { useNavigate }    from 'react-router-dom';
import toast              from 'react-hot-toast';
import { useAuth }        from '../hooks/useAuth.js';
import apiClient          from '../apiClient.js';

export default function LoginPage() {
  const { setAuth  }    = useAuth();
  const navigate     = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast.error('Please enter username and password.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await apiClient.post('/api/auth/login', { username, password });
      setAuth(data);
      navigate('/home', { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error ?? 'Login failed. Please try again.';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand mb-4">
            <span className="text-white text-2xl font-bold">U</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">Unaav Queue</h1>
          <p className="text-sm text-gray-500 mt-1">Manager Dashboard</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. RaviDwarka"
              autoComplete="username"
              autoFocus
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent
                         placeholder-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent
                         placeholder-gray-400"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-brand hover:bg-brand-dark text-white
                       text-sm font-semibold rounded-lg transition-colors
                       disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}