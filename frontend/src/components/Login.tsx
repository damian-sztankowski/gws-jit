import { useState } from 'react';
import AnimatedLogo from './AnimatedLogo.tsx';
import { User } from '../types.ts';
import { Eye, EyeOff, AlertCircle, ArrowRight } from 'lucide-react';

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Work email and password are required.');
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
        showToast(`Authenticated as ${data.user.email}`, 'success');
        onLoginSuccess(data.token, data.user);
      } else {
        setError(data.error || 'Authentication failed. Check your credentials.');
      }
    } catch {
      setError('Unable to reach the JIT access service.');
      showToast('Network error during authentication.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = () => {
    setEmail('superadmin@company.com');
    setPassword('password');
    setError('');
  };

  return (
    <div className="vault-layout">
      {/* Left Architectural Security Brief */}
      <aside className="vault-brief">
        <div className="vault-brand">
          <AnimatedLogo size={30} />
          <span className="vault-brand-title">GWS JIT</span>
          <span className="vault-brand-tag">Workspace PAM</span>
        </div>

        <div className="vault-hero">
          <h1 className="vault-headline">
            Zero standing privileges for Google Workspace.
          </h1>
          <p className="vault-lead">
            Replace permanent Super Admin assignments with audited, time-bounded group elevations backed by peer quorum and automatic revocation.
          </p>

          <div className="vault-specs">
            <div className="vault-spec-row">
              <span className="vault-spec-idx">01</span>
              <div>
                <div className="vault-spec-title">Ephemeral Directory Grants</div>
                <div className="vault-spec-desc">
                  Memberships are provisioned on demand and stripped deterministically when the TTL expires.
                </div>
              </div>
            </div>

            <div className="vault-spec-row">
              <span className="vault-spec-idx">02</span>
              <div>
                <div className="vault-spec-title">Dual-Custody Quorum & Break-Glass</div>
                <div className="vault-spec-desc">
                  Enforce single or two-peer approval policies with incident-bound 30m P0 overrides.
                </div>
              </div>
            </div>

            <div className="vault-spec-row">
              <span className="vault-spec-idx">03</span>
              <div>
                <div className="vault-spec-title">Keyless Workload Identity</div>
                <div className="vault-spec-desc">
                  Domain-Wide Delegation assertions signed via GCP IAM Credentials without static JSON keys.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="vault-meta-foot">
          <span className="led led--emerald" />
          <span>ADMIN DIRECTORY SDK V1</span>
          <span>·</span>
          <span>IMMUTABLE AUDIT LEDGER</span>
        </div>
      </aside>

      {/* Right Authentication Form */}
      <main className="vault-form-pane">
        <div className="vault-form-box">
          <div>
            <div className="eyebrow" style={{ marginBottom: '0.4rem' }}> Operator Authentication </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Sign in to console</h2>
            <p className="field-hint" style={{ marginTop: '0.25rem' }}>
              Enter your directory credentials to request or review group elevations.
            </p>
          </div>

          {error && (
            <div className="callout callout--danger" role="alert">
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="email" className="field-label">Work email</label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="operator@company.com"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="password" className="field-label">Password</label>
              <div className="input-wrap">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="input input--with-trail"
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="input-trail-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-block"
              style={{ marginTop: '1.35rem' }}
              disabled={loading}
            >
              {loading ? 'Verifying credentials...' : 'Sign in'}
              {!loading && <ArrowRight size={14} />}
            </button>
          </form>

          <div className="vault-sandbox-strip">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--ink-900)' }}>
                Bootstrap Administrator
              </div>
              <div className="text-mono text-muted" style={{ fontSize: '0.69rem' }}>
                superadmin@company.com
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleQuickFill}
            >
              Autofill
            </button>
          </div>

          <p className="field-hint" style={{ fontSize: '0.7rem' }}>
            Rotate the default bootstrap password under <strong>Identities</strong> prior to production deployment, or enforce <code>AUTH_MODE=IAP</code> behind Google Cloud IAP.
          </p>
        </div>
      </main>
    </div>
  );
}
