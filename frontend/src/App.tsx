import { useState, useEffect } from 'react';
import {
  RefreshCw,
  Globe,
  Download,
  LogOut,
  Search,
  ShieldCheck,
  FileText,
  Users,
  Sliders,
  BookOpen
} from 'lucide-react';
import Dashboard from './components/Dashboard.tsx';
import Request from './components/Request.tsx';
import SettingsView from './components/Settings.tsx';
import UserManagement from './components/UserManagement.tsx';
import AnimatedLogo from './components/AnimatedLogo.tsx';
import Login from './components/Login.tsx';
import Documentation from './components/Documentation.tsx';
import { AppConfig, JitRequest, User, SpaceConfig, AuditLog } from './types.ts';
import {
  getAuthHeaders,
  getStoredToken,
  isAuthenticatedSession,
  setIapSessionActive
} from './api.ts';

type ViewId = 'dashboard' | 'audit' | 'users' | 'settings' | 'docs';

function App() {
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [user, setUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [requests, setRequests] = useState<JitRequest[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [eligibleGroupCount, setEligibleGroupCount] = useState<number>(0);
  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string>('global');

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'success'
  ) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3800);
  };

  const fetchConfig = async () => {
    if (!isAuthenticatedSession()) return;
    try {
      const res = await fetch('/api/config', { headers: getAuthHeaders() });
      if (res.ok) {
        setConfig(await res.json());
      }
    } catch {
      showToast('Failed to load system configuration.', 'error');
    }
  };

  const fetchRequests = async () => {
    if (!isAuthenticatedSession()) return;
    try {
      const res = await fetch('/api/requests', { headers: getAuthHeaders() });
      if (res.ok) {
        setRequests(await res.json());
      }
    } catch {
      showToast('Failed to load requests.', 'error');
    }
  };

  const fetchSpaces = async () => {
    if (!isAuthenticatedSession()) return;
    try {
      const res = await fetch('/api/spaces', { headers: getAuthHeaders() });
      if (res.ok) {
        setSpaces(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch spaces', err);
    }
  };

  const verifyProfile = async () => {
    try {
      const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        await handleLogout(true);
      }
    } catch (err) {
      console.error('Unable to verify user profile.', err);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        fetchConfig(),
        fetchRequests(),
        fetchSpaces(),
        verifyProfile()
      ]);
      setRefreshTrigger((prev) => prev + 1);
      showToast('Directory state synchronized.', 'info');
    } catch {
      showToast('Synchronization failed.', 'error');
    } finally {
      setTimeout(() => setIsRefreshing(false), 350);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          if (data.authMode === 'IAP') {
            setIapSessionActive(true);
            setToken('IAP_SESSION');
          }
        } else if (getStoredToken()) {
          localStorage.removeItem('jit_token');
          setIapSessionActive(false);
          setToken(null);
          setUser(null);
        }
      } catch (err) {
        console.error('Auth initialization failed:', err);
      }
    };
    initializeAuth();
  }, []);

  useEffect(() => {
    if (!token) return;

    verifyProfile();
    fetchConfig();
    fetchRequests();
    fetchSpaces();

    const sseUrl =
      token !== 'IAP_SESSION'
        ? `/api/events?token=${encodeURIComponent(token)}`
        : '/api/events';

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource(sseUrl);
      eventSource.onopen = () => setSseConnected(true);
      eventSource.onerror = () => setSseConnected(false);
      eventSource.onmessage = (evt) => {
        try {
          const parsed = JSON.parse(evt.data);
          if (parsed.type === 'CONNECTED') {
            setSseConnected(true);
          } else if (parsed.type) {
            fetchRequests();
            setRefreshTrigger((prev) => prev + 1);
          }
        } catch {
          // Ignore malformed event frames
        }
      };
    } catch {
      setSseConnected(false);
    }

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchRequests();
      }
    }, 12000);

    return () => {
      clearInterval(interval);
      eventSource?.close();
      setSseConnected(false);
    };
  }, [token]);

  useEffect(() => {
    if (user && spaces.length > 0) {
      const hasGlobalAccess =
        user.role === 'ADMIN' || (user.assignedSpaces || []).includes('global');
      if (activeSpaceId === 'global' && !hasGlobalAccess) {
        const accessibleNonGlobal = spaces.filter((s) =>
          (user.assignedSpaces || []).includes(s.id)
        );
        if (accessibleNonGlobal.length > 0) {
          setActiveSpaceId(accessibleNonGlobal[0].id);
        }
      }
    }
  }, [user, spaces, activeSpaceId]);

  const handleLoginSuccess = (newToken: string, loggedInUser: User) => {
    localStorage.setItem('jit_token', newToken);
    setToken(newToken);
    setUser(loggedInUser);
  };

  const handleLogout = async (silent = false) => {
    const isIap = token === 'IAP_SESSION';
    if (!isIap && getStoredToken()) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: getAuthHeaders()
      }).catch(() => {});
    }
    localStorage.removeItem('jit_token');
    setIapSessionActive(false);
    setToken(null);
    setUser(null);
    setConfig(null);
    setRequests([]);
    setSpaces([]);
    setActiveView('dashboard');

    if (!silent) {
      if (isIap) {
        showToast('Sign out of Google Workspace to terminate your IAP session.', 'info');
      } else {
        showToast('Session terminated.', 'info');
      }
    }
  };

  const renderToast = () => {
    if (!toast) return null;
    const ledClass =
      toast.type === 'error'
        ? 'led--crimson'
        : toast.type === 'info'
          ? 'led--amber'
          : 'led--emerald';
    return (
      <div className="toast" role="status" aria-live="polite">
        <span className={`led ${ledClass}`} />
        <span>{toast.message}</span>
      </div>
    );
  };

  if (!token || !user) {
    return (
      <>
        <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />
        {renderToast()}
      </>
    );
  }

  const spaceRequests = requests.filter((r) => {
    if (activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });

  const activeCount = spaceRequests.filter((r) => r.status === 'ACTIVE').length;
  const pendingCount = spaceRequests.filter((r) => r.status === 'PENDING').length;
  const totalRequests = spaceRequests.length;

  const reviewBadgeCount =
    user.role === 'ADMIN' || user.role === 'APPROVER'
      ? requests.filter((r) => r.status === 'PENDING').length
      : pendingCount;

  const accessibleSpaces =
    user.role === 'ADMIN'
      ? spaces
      : spaces.filter((s) => (user.assignedSpaces || []).includes(s.id));

  const activeSpacePolicies =
    activeSpaceId === 'global'
      ? config?.groupPolicies || []
      : spaces.find((s) => s.id === activeSpaceId)?.groupPolicies || [];

  const activeSpaceObj = spaces.find((s) => s.id === activeSpaceId);
  const activeDomainLabel =
    activeSpaceId === 'global'
      ? config?.domain || 'company.com'
      : activeSpaceObj?.domain || 'space';

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const canViewAuditLedger = user.role === 'ADMIN' || user.role === 'AUDITOR';

  const breadcrumbMeta: Record<ViewId, { group: string; label: string }> = {
    dashboard: { group: 'Operations', label: 'Access Control' },
    audit: {
      group: 'Operations',
      label: canViewAuditLedger ? 'Audit Ledger' : 'Session History'
    },
    users: { group: 'Governance', label: 'Identities' },
    settings: { group: 'Governance', label: 'Policies & Spaces' },
    docs: { group: 'Reference', label: 'Documentation' }
  };

  return (
    <div className="console-shell">
      {/* Precision Left Architectural Rail */}
      <aside className="console-rail">
        <div className="rail-top">
          <button
            type="button"
            className="rail-brand"
            onClick={() => setActiveView('dashboard')}
          >
            <div className="rail-brand-left">
              <AnimatedLogo size={28} />
              <div>
                <div className="rail-brand-name">GWS JIT</div>
                <div className="rail-brand-sub">Privileged Access</div>
              </div>
            </div>
            <span className="pill pill-neutral" style={{ fontSize: '0.6rem', padding: '0.08rem 0.35rem' }}>
              v2.4
            </span>
          </button>

          {/* Directory Scope Switcher */}
          <div className="rail-scope-box">
            <span className="rail-scope-label">Directory Scope</span>
            <div className="rail-scope-select-wrap">
              <Globe size={13} style={{ color: 'var(--cobalt-600)', flexShrink: 0 }} />
              <select
                aria-label="Active Workspace Scope"
                className="rail-scope-select"
                value={activeSpaceId}
                onChange={(e) => setActiveSpaceId(e.target.value)}
              >
                {(user.role === 'ADMIN' ||
                  (user.assignedSpaces || []).includes('global')) && (
                  <option value="global">
                    Global · {config?.domain || 'company.com'}
                  </option>
                )}
                {accessibleSpaces.map((space) => (
                  <option key={space.id} value={space.id}>
                    {space.name} · {space.domain}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Primary Navigation Groups */}
          <nav className="stack-md" aria-label="Console navigation">
            <div className="rail-section">
              <div className="rail-section-label">Operations</div>
              <button
                type="button"
                className={`rail-link ${activeView === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveView('dashboard')}
              >
                <span className="rail-link-main">
                  <ShieldCheck size={15} className="rail-link-icon" />
                  Access Control
                </span>
                {reviewBadgeCount > 0 && (
                  <span className="rail-badge">{reviewBadgeCount}</span>
                )}
              </button>

              <button
                type="button"
                className={`rail-link ${activeView === 'audit' ? 'active' : ''}`}
                onClick={() => setActiveView('audit')}
              >
                <span className="rail-link-main">
                  <FileText size={15} className="rail-link-icon" />
                  {canViewAuditLedger ? 'Audit Ledger' : 'Session History'}
                </span>
              </button>
            </div>

            {user.role === 'ADMIN' && (
              <div className="rail-section">
                <div className="rail-section-label">Governance</div>
                <button
                  type="button"
                  className={`rail-link ${activeView === 'users' ? 'active' : ''}`}
                  onClick={() => setActiveView('users')}
                >
                  <span className="rail-link-main">
                    <Users size={15} className="rail-link-icon" />
                    Identities
                  </span>
                </button>
                <button
                  type="button"
                  className={`rail-link ${activeView === 'settings' ? 'active' : ''}`}
                  onClick={() => setActiveView('settings')}
                >
                  <span className="rail-link-main">
                    <Sliders size={15} className="rail-link-icon" />
                    Policies & Spaces
                  </span>
                </button>
              </div>
            )}

            <div className="rail-section">
              <div className="rail-section-label">Reference</div>
              <button
                type="button"
                className={`rail-link ${activeView === 'docs' ? 'active' : ''}`}
                onClick={() => setActiveView('docs')}
              >
                <span className="rail-link-main">
                  <BookOpen size={15} className="rail-link-icon" />
                  Documentation
                </span>
              </button>
            </div>
          </nav>
        </div>

        {/* Bottom Telemetry & Operator Card */}
        <div className="rail-bottom">
          <div className="rail-telemetry">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
              <span className={`led ${config?.mode === 'LIVE' ? 'led--emerald' : 'led--amber'}`} />
              {config?.mode || 'MOCK'} ENGINE
            </span>
            <span style={{ color: sseConnected ? 'var(--emerald-ink)' : 'var(--ink-400)' }}>
              {sseConnected ? '● STREAM' : '○ POLL'}
            </span>
          </div>

          <div className="rail-user-card">
            <div className="rail-user-head">
              <div className="rail-user-id">
                <span className="user-monogram">{initials || 'OP'}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="rail-user-name">{user.name}</div>
                  <div className="rail-user-email">{user.email}</div>
                </div>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => handleLogout(false)}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>

            <div className="rail-user-tags">
              <span className="pill pill-cobalt" style={{ fontSize: '0.62rem', padding: '0.05rem 0.38rem' }}>
                {user.role}
              </span>
              {(user.attributes || []).map((attr) => (
                <span key={attr} className="tag-chip" style={{ fontSize: '0.63rem', padding: '0.04rem 0.34rem' }}>
                  {attr}
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Inset White Architectural Stage */}
      <main className="console-stage">
        <header className="stage-topbar">
          <div className="stage-crumbs">
            <span className="stage-crumb-root">{breadcrumbMeta[activeView].group}</span>
            <span className="stage-crumb-sep">/</span>
            <span className="stage-crumb-current">{breadcrumbMeta[activeView].label}</span>
          </div>

          <div className="stage-actions">
            <span className="tag-chip">@{activeDomainLabel}</span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleManualRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw size={12} className={isRefreshing ? 'spin' : ''} />
              Sync
            </button>
          </div>
        </header>

        {activeView === 'users' && user.role === 'ADMIN' ? (
          <div className="stage-body">
            <div className="page-intro">
              <div>
                <h1 className="page-title">Directory Identities</h1>
                <p className="page-subtitle">
                  Manage operator roles, ABAC authorization tags, and multi-tenant space assignments.
                </p>
              </div>
            </div>
            <UserManagement
              currentUser={user}
              showToast={showToast}
              refreshTrigger={refreshTrigger}
              eligibleAttributes={config?.eligibleAttributes || []}
            />
          </div>
        ) : activeView === 'settings' && user.role === 'ADMIN' ? (
          <div className="stage-body">
            <div className="page-intro">
              <div>
                <h1 className="page-title">Policies & Tenant Spaces</h1>
                <p className="page-subtitle">
                  Configure Domain-Wide Delegation, group quorum & TTL bounds, webhooks, and recertification reviews.
                </p>
              </div>
            </div>
            <SettingsView
              showToast={showToast}
              onConfigUpdated={() => {
                fetchConfig();
                fetchSpaces();
              }}
            />
          </div>
        ) : activeView === 'audit' ? (
          <div className="stage-body">
            <div className="page-intro">
              <div>
                <h1 className="page-title">
                  {canViewAuditLedger ? 'Immutable Security Audit Ledger' : 'Personal Elevation History'}
                </h1>
                <p className="page-subtitle">
                  {canViewAuditLedger
                    ? 'Cryptographically timestamped record of all privilege requests, peer approvals, break-glass overrides, and revocations.'
                    : 'Chronological record of your past directory elevation requests in this scope.'}
                </p>
              </div>
            </div>
            {canViewAuditLedger ? (
              <AuditTrailView showToast={showToast} refreshTrigger={refreshTrigger} />
            ) : (
              <section className="surface-card">
                <DashboardHistory
                  currentUser={user}
                  requests={requests}
                  activeSpaceId={activeSpaceId}
                  spaces={spaces}
                />
              </section>
            )}
          </div>
        ) : activeView === 'docs' ? (
          <div className="stage-body">
            <div className="page-intro">
              <div>
                <h1 className="page-title">Architecture & Operations Manual</h1>
                <p className="page-subtitle">
                  Workload Identity setup, Domain-Wide Delegation scopes, and operator procedures.
                </p>
              </div>
            </div>
            <Documentation />
          </div>
        ) : (
          <>
            {/* Full-Bleed Architectural Telemetry Ribbon */}
            <section className="telemetry-ribbon" aria-label="Operational telemetry">
              <div className="telemetry-cell">
                <span className="telemetry-label">
                  <span className="led led--emerald" />
                  Active Grants
                </span>
                <span className="telemetry-value">{activeCount}</span>
                <span className="telemetry-sub">Time-bounded directory leases</span>
              </div>

              <div className="telemetry-cell">
                <span className="telemetry-label">
                  <span className="led led--amber" />
                  Custody Queue
                </span>
                <span className="telemetry-value">{pendingCount}</span>
                <span className="telemetry-sub">Awaiting peer verification</span>
              </div>

              <div className="telemetry-cell">
                <span className="telemetry-label">
                  <span className="led" style={{ background: 'var(--cobalt-500)' }} />
                  Eligible Groups
                </span>
                <span className="telemetry-value">
                  {user.role === 'AUDITOR' ? activeSpacePolicies.length : eligibleGroupCount}
                </span>
                <span className="telemetry-sub">Matched via ABAC tags</span>
              </div>

              <div className="telemetry-cell">
                <span className="telemetry-label">
                  <span className="led led--slate" />
                  Scope Ledger
                </span>
                <span className="telemetry-value">{totalRequests}</span>
                <span className="telemetry-sub">Total requests in scope</span>
              </div>
            </section>

            {/* Full-Bleed 2-Column Architectural Split */}
            <div
              className={`console-split ${
                user.role === 'AUDITOR' ? 'console-split--single' : ''
              }`}
            >
              {user.role !== 'AUDITOR' && (
                <div className="split-composer">
                  <Request
                    currentUser={user}
                    showToast={showToast}
                    onSuccess={fetchRequests}
                    activeSpaceId={activeSpaceId}
                    activeSpacePolicies={activeSpacePolicies}
                    onEligibleCountChange={setEligibleGroupCount}
                  />
                </div>
              )}

              <div className="split-Feed">
                <Dashboard
                  currentUser={user}
                  requests={requests}
                  fetchRequests={fetchRequests}
                  showToast={showToast}
                  activeSpaceId={activeSpaceId}
                  spaces={spaces}
                  globalPolicies={config?.groupPolicies || []}
                />

                <section className="feed-block">
                  <div className="block-header">
                    <div>
                      <h3 className="card-title">Recent elevation history</h3>
                      <p className="card-subtitle">Completed, expired, revoked, and rejected sessions for your identity</p>
                    </div>
                  </div>
                  <DashboardHistory
                    currentUser={user}
                    requests={requests}
                    activeSpaceId={activeSpaceId}
                    spaces={spaces}
                  />
                </section>
              </div>
            </div>
          </>
        )}
      </main>

      {renderToast()}
    </div>
  );
}

function DashboardHistory({
  currentUser,
  requests,
  activeSpaceId,
  spaces
}: {
  currentUser: User;
  requests: JitRequest[];
  activeSpaceId: string;
  spaces: SpaceConfig[];
}) {
  const userRequests = requests.filter(
    (r) => r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase()
  );
  const spaceRequests = userRequests.filter((r) => {
    if (activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });
  const historyRequests = spaceRequests.filter((r) => r.status !== 'ACTIVE');

  const statusPillClass = (status: JitRequest['status']) => {
    switch (status) {
      case 'PENDING':
        return 'pill-pending';
      case 'APPROVED':
        return 'pill-active';
      case 'DENIED':
        return 'pill-denied';
      case 'REVOKED':
        return 'pill-revoked';
      default:
        return 'pill-expired';
    }
  };

  if (historyRequests.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">No historical records</div>
        <span>Past elevation leases for your principal will appear here.</span>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Timestamp</th>
            <th>TTL</th>
            <th>Status</th>
            <th>Audit Context</th>
          </tr>
        </thead>
        <tbody>
          {historyRequests.map((req) => (
            <tr key={req.id}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600 }}>{req.groupName}</span>
                  <span className="pill pill-neutral">
                    {spaces.find((s) => s.id === req.spaceId)?.name || 'Global'}
                  </span>
                  {req.isBreakGlass && (
                    <span className="pill pill-denied">BREAK-GLASS</span>
                  )}
                  {req.ticketId && (
                    <span className="tag-chip">{req.ticketId}</span>
                  )}
                </div>
                <div className="text-mono text-muted" style={{ fontSize: '0.69rem', marginTop: '0.1rem' }}>
                  {req.groupEmail}
                </div>
              </td>
              <td className="text-mono text-muted tabular" style={{ whiteSpace: 'nowrap' }}>
                {new Date(req.requestedAt).toISOString().replace('T', ' ').slice(0, 19)}
              </td>
              <td className="text-mono text-muted tabular">{req.durationMinutes}m</td>
              <td>
                <span className={`pill ${statusPillClass(req.status)}`}>
                  {req.status}
                </span>
              </td>
              <td className="text-muted">
                <div>
                  {req.status === 'DENIED' && req.approverEmail
                    ? `Rejected by ${req.approverEmail}`
                    : req.justification}
                </div>
                {req.reviewNote && (
                  <div style={{ fontSize: '0.72rem', marginTop: '0.15rem' }}>
                    Reviewer note: {req.reviewNote}
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTrailView({
  showToast,
  refreshTrigger
}: {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  refreshTrigger: number;
}) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'ALL' | 'REQUEST' | 'APPROVE' | 'REVOKE' | 'CONFIG'>('ALL');

  const handleExport = async () => {
    try {
      showToast('Generating RFC-4180 CSV export...', 'info');
      const res = await fetch('/api/logs/export', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gws-jit-audit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast('Audit ledger exported.', 'success');
      } else {
        showToast('Failed to export audit ledger.', 'error');
      }
    } catch {
      showToast('Error downloading CSV export.', 'error');
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await fetch('/api/logs', { headers: getAuthHeaders() });
      if (res.ok) {
        setLogs(await res.json());
      } else {
        showToast('Insufficient permissions to read audit ledger.', 'error');
      }
    } catch {
      showToast('Failed to fetch audit ledger.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [refreshTrigger]);

  const actionPillClass = (action: string) => {
    if (action.includes('BREAK_GLASS')) return 'pill-denied';
    if (action.includes('APPROVE') || action.includes('ACTIVATE') || action.includes('EXTEND') || action.includes('REMEDIATE')) {
      return 'pill-active';
    }
    if (action.includes('REQUEST')) return 'pill-pending';
    if (action.includes('DENY') || action.includes('REVOKE') || action.includes('ERROR') || action.includes('ORPHAN')) {
      return 'pill-denied';
    }
    return 'pill-neutral';
  };

  const filteredLogs = logs.filter((log) => {
    const matchesCategory =
      category === 'ALL' ||
      (category === 'REQUEST' && (log.action.includes('REQUEST') || log.action.includes('BREAK_GLASS'))) ||
      (category === 'APPROVE' && (log.action.includes('APPROVE') || log.action.includes('ACTIVATE') || log.action.includes('EXTEND'))) ||
      (category === 'REVOKE' && (log.action.includes('REVOKE') || log.action.includes('DENY') || log.action.includes('REMEDIATE'))) ||
      (category === 'CONFIG' && (log.action.includes('CONFIG') || log.action.includes('SPACE') || log.action.includes('USER') || log.action.includes('ATTEST')));

    if (!matchesCategory) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      log.actor.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <section className="surface-card">
        <div className="empty-state">
          <span>Loading audit ledger...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card">
      <div className="card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', flex: 1 }}>
          <div className="input-wrap" style={{ maxWidth: '280px' }}>
            <Search size={14} className="input-icon" />
            <input
              type="text"
              className="input input--with-icon"
              style={{ height: '32px', fontSize: '0.79rem' }}
              placeholder="Search principal, event, or ticket..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="segmented" role="group" aria-label="Filter by event category">
            {(['ALL', 'REQUEST', 'APPROVE', 'REVOKE', 'CONFIG'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={`segmented-btn ${category === cat ? 'active' : ''}`}
                style={{ height: '26px', fontSize: '0.72rem', padding: '0 0.55rem' }}
                onClick={() => setCategory(cat)}
              >
                {cat === 'ALL' ? 'All' : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExport}>
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {filteredLogs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">No matching ledger entries</div>
          <span>Adjust your search query or event category filter.</span>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>UTC Timestamp</th>
                <th>Principal</th>
                <th>Event Type</th>
                <th>Ledger Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id}>
                  <td className="text-mono text-muted tabular" style={{ whiteSpace: 'nowrap' }}>
                    {new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 19)}Z
                  </td>
                  <td className="text-mono" style={{ fontWeight: 500 }}>
                    {log.actor}
                  </td>
                  <td>
                    <span className={`pill ${actionPillClass(log.action)}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="text-muted">{log.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default App;
