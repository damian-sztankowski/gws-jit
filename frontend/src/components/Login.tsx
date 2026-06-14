import { useState } from 'react';
import AnimatedLogo from './AnimatedLogo.tsx';
import { User } from '../types.ts';
import { Shield, Key, Eye, EyeOff } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (token: string, user: User) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export default function Login({ onLoginSuccess, showToast }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const simulationAccounts = [
    { email: 'superadmin@company.com', name: 'Super Admin', role: 'System Admin', desc: 'Full Access Administrator' }
  ];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        showToast(`Welcome back, ${data.user.name}!`, 'success');
        onLoginSuccess(data.token, data.user);
      } else {
        setError(data.error || 'Invalid email or password.');
        showToast(data.error || 'Authentication failed.', 'error');
      }
    } catch (err) {
      setError('Unable to connect to JIT Server.');
      showToast('Network error during login.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (emailVal: string) => {
    setEmail(emailVal);
    setPassword('password');
    setError('');
  };

  return (
    <div className="login-viewport">
      <div className="login-card">
        <div className="login-header">
          <AnimatedLogo size={48} className="login-logo" />
          <h2>GWS JIT Access Portal</h2>
          <p>Self-service Just-In-Time access management for administrative groups</p>
        </div>

        {error && (
          <div className="login-error-banner">
            <Shield size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="login-form">
          <div className="form-input-group">
            <label htmlFor="email">Work Email</label>
            <div className="input-with-icon">
              <Shield size={16} className="field-icon" />
              <input
                id="email"
                type="email"
                className="clean-control"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-input-group" style={{ marginTop: '1rem' }}>
            <label htmlFor="password">Password</label>
            <div className="input-with-icon">
              <Key size={16} className="field-icon" />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="clean-control"
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="clean-btn clean-btn-primary"
            style={{ width: '100%', padding: '0.85rem', marginTop: '1.5rem', fontSize: '0.95rem' }}
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="login-divider">
          <span>Simulation Directory Helper</span>
        </div>

        <div className="simulation-helper-grid" style={{ gridTemplateColumns: '1fr' }}>
          {simulationAccounts.map((account) => (
            <button
              key={account.email}
              type="button"
              className="sim-account-card"
              onClick={() => handleQuickFill(account.email)}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '100%' }}
            >
              <div className="sim-account-info" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <span className="sim-account-name" style={{ fontWeight: 700 }}>{account.name}</span>
                <span className="sim-account-role" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', border: '1px solid currentColor', borderRadius: '4px' }}>{account.role}</span>
              </div>
              <span className="sim-account-desc" style={{ fontSize: '0.75rem', marginTop: '0.2rem' }}>{account.desc}</span>
            </button>
          ))}
        </div>

        <div style={{
          marginTop: '1.25rem',
          padding: '0.75rem 1rem',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.25)',
          borderRadius: '8px',
          fontSize: '0.75rem',
          color: 'var(--status-denied)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.2rem',
          lineHeight: '1.4'
        }}>
          <strong>⚠️ Security Notice:</strong>
          <span>The portal has been initialized with a single default Super Admin user. You must change the password immediately under the User Management tab.</span>
        </div>
      </div>
    </div>
  );
}
