import { useState, useEffect } from 'react';
import { Clock, Settings, Users, ClipboardList, Database, LogOut, RefreshCw, Globe, BookOpen } from 'lucide-react';
import Dashboard from './components/Dashboard.tsx';
import Request from './components/Request.tsx';
import SettingsView from './components/Settings.tsx';
import UserManagement from './components/UserManagement.tsx';
import AnimatedLogo from './components/AnimatedLogo.tsx';
import Login from './components/Login.tsx';
import Documentation from './components/Documentation.tsx';
import { AppConfig, JitRequest, User, SpaceConfig } from './types.ts';

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('jit_token'));
  const [user, setUser] = useState<User | null>(null);
  const [activeView, setActiveView] = useState<'dashboard' | 'users' | 'docs'>('dashboard');
  const [activeSubTab, setActiveSubTab] = useState<'history' | 'logs'>('history');
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [requests, setRequests] = useState<JitRequest[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeSpaceId, setActiveSpaceId] = useState<string>('global');

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchConfig = async () => {
    const activeToken = localStorage.getItem('jit_token');
    if (!activeToken) return;
    try {
      const res = await fetch('/api/config', {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      showToast("Failed to fetch system configuration.", "error");
    }
  };

  const fetchRequests = async () => {
    const activeToken = localStorage.getItem('jit_token');
    if (!activeToken) return;
    try {
      const res = await fetch('/api/requests', {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setRequests(data);
      }
    } catch (err) {
      showToast("Failed to fetch requests.", "error");
    }
  };

  const fetchSpaces = async () => {
    const activeToken = localStorage.getItem('jit_token');
    if (!activeToken) return;
    try {
      const res = await fetch('/api/spaces', {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSpaces(data);
      }
    } catch (err) {
      console.error("Failed to fetch spaces list", err);
    }
  };

  const verifyProfile = async () => {
    const activeToken = localStorage.getItem('jit_token');
    const headers: Record<string, string> = {};
    if (activeToken && activeToken !== 'IAP_SESSION') {
      headers['Authorization'] = `Bearer ${activeToken}`;
    }
    try {
      const res = await fetch('/api/auth/me', { headers });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        handleLogout();
      }
    } catch (err) {
      console.error("Unable to verify user profile with server.", err);
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
      setRefreshTrigger(prev => prev + 1);
      showToast("Data refreshed successfully.", "success");
    } catch (err) {
      showToast("Failed to refresh data.", "error");
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  // Check auth status on initial load (handles IAP auto-login)
  useEffect(() => {
    const initializeAuth = async () => {
      const savedToken = localStorage.getItem('jit_token');
      const headers: Record<string, string> = {};
      if (savedToken) {
        headers['Authorization'] = `Bearer ${savedToken}`;
      }
      
      try {
        const res = await fetch('/api/auth/me', { headers });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          if (data.authMode === 'IAP') {
            setToken('IAP_SESSION');
          }
        } else {
          if (savedToken) {
            localStorage.removeItem('jit_token');
            setToken(null);
            setUser(null);
          }
        }
      } catch (err) {
        console.error("Auth check failed:", err);
      }
    };
    initializeAuth();
  }, []);

  useEffect(() => {
    if (token) {
      verifyProfile();
      fetchConfig();
      fetchRequests();
      fetchSpaces();
      
      const interval = setInterval(() => {
        fetchRequests();
        verifyProfile();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [token]);

  useEffect(() => {
    if (user && spaces.length > 0) {
      const hasGlobalAccess = user.role === 'ADMIN' || (user.assignedSpaces || []).includes('global');
      if (activeSpaceId === 'global' && !hasGlobalAccess) {
        const accessibleNonGlobal = spaces.filter(s => (user.assignedSpaces || []).includes(s.id));
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

  const handleLogout = () => {
    localStorage.removeItem('jit_token');
    const isIap = token === 'IAP_SESSION';
    setToken(null);
    setUser(null);
    setConfig(null);
    setRequests([]);
    setSpaces([]);
    if (isIap) {
      showToast("To complete log out, please sign out of your Google Workspace account.", "info");
    } else {
      showToast("Signed out successfully.", "info");
    }
  };

  if (!token || !user) {
    return (
      <>
        <Login onLoginSuccess={handleLoginSuccess} showToast={showToast} />
        {toast && (
          <div className="clean-toast" style={{
            borderColor: toast.type === 'error' ? 'var(--status-denied)' : 
                         toast.type === 'info' ? 'var(--secondary)' : 
                         'var(--status-active)'
          }}>
            {toast.type === 'error' ? <span style={{ color: 'var(--status-denied)' }}>●</span> : 
             toast.type === 'info' ? <span style={{ color: 'var(--secondary)' }}>●</span> : 
             <span style={{ color: 'var(--status-active)' }}>●</span>}
            {toast.message}
          </div>
        )}
      </>
    );
  }

  // Metrics (Filtered by active space)
  const spaceRequests = requests.filter(r => {
    if (activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });

  const activeCount = spaceRequests.filter(r => r.status === 'ACTIVE').length;
  const pendingCount = spaceRequests.filter(r => r.status === 'PENDING').length;
  const totalRequests = spaceRequests.length;

  const accessibleSpaces = user.role === 'ADMIN' 
    ? spaces 
    : spaces.filter(s => (user.assignedSpaces || []).includes(s.id));

  const activeSpacePolicies = activeSpaceId === 'global'
    ? (config?.groupPolicies || [])
    : (spaces.find(s => s.id === activeSpaceId)?.groupPolicies || []);

  const activeSpaceObj = spaces.find(s => s.id === activeSpaceId);

  return (
    <div className="command-center">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-top" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="sidebar-logo-sec">
            <AnimatedLogo size={32} />
            <div className="logo-text">
              <h1>GWS JIT</h1>
              <span>Group Access</span>
            </div>
          </div>

          {/* Space Switcher */}
          {spaces.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0 0.2rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.05em' }}>
                Active Space
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(15, 23, 42, 0.03)', border: '1px solid rgba(15, 23, 42, 0.05)', borderRadius: '8px', padding: '0.4rem 0.6rem' }}>
                <Globe size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                <select
                  className="profile-select-control"
                  style={{ fontSize: '0.8rem', fontWeight: 700, border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-main)', width: '100%', cursor: 'pointer' }}
                  value={activeSpaceId}
                  onChange={(e) => setActiveSpaceId(e.target.value)}
                >
                  {(user.role === 'ADMIN' || (user.assignedSpaces || []).includes('global')) && (
                    <option value="global">Global Config ({config?.domain || 'system'})</option>
                  )}
                  {accessibleSpaces.map(space => (
                    <option key={space.id} value={space.id}>
                      {space.name} ({space.domain})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="sidebar-nav">
            <button 
              className={`sidebar-nav-btn ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveView('dashboard')}
            >
              <Clock size={16} />
              Command Center
            </button>
            {user.role === 'ADMIN' && (
              <button 
                className={`sidebar-nav-btn ${activeView === 'users' ? 'active' : ''}`}
                onClick={() => setActiveView('users')}
              >
                <Users size={16} />
                User Accounts
              </button>
            )}
            {user.role === 'ADMIN' && (
              <button className="sidebar-nav-btn" onClick={() => setShowSettings(true)}>
                <Settings size={16} />
                Portal Settings
              </button>
            )}
            <button 
              className={`sidebar-nav-btn ${activeView === 'docs' ? 'active' : ''}`}
              onClick={() => setActiveView('docs')}
            >
              <BookOpen size={16} />
              Documentation
            </button>
          </div>

          {/* Dynamic Base Privileges based on Role */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
              Base Privileges ({user.role})
            </span>
            <div style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--card-border)', padding: '0.65rem 0.85rem', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {(() => {
                  const getPrivs = (role: string) => {
                    switch (role) {
                      case 'ADMIN':
                        return [
                          { name: 'JIT Requesting', status: 'Allowed', active: true },
                          { name: 'Peer Approval', status: 'Allowed', active: true },
                          { name: 'User Management', status: 'Allowed', active: true },
                          { name: 'Security Auditing', status: 'Allowed', active: true },
                          { name: 'Portal Settings', status: 'Allowed', active: true }
                        ];
                      case 'APPROVER':
                        return [
                          { name: 'Peer Approval', status: 'Allowed', active: true },
                          { name: 'JIT Requesting', status: 'Disabled', active: false },
                          { name: 'User Management', status: 'Disabled', active: false },
                          { name: 'Security Auditing', status: 'Disabled', active: false },
                          { name: 'Portal Settings', status: 'Disabled', active: false }
                        ];
                      case 'AUDITOR':
                        return [
                          { name: 'Security Auditing', status: 'Allowed', active: true },
                          { name: 'JIT Requesting', status: 'Disabled', active: false },
                          { name: 'Peer Approval', status: 'Disabled', active: false },
                          { name: 'User Management', status: 'Disabled', active: false },
                          { name: 'Portal Settings', status: 'Disabled', active: false }
                        ];
                      case 'REQUESTER':
                      default:
                        return [
                          { name: 'JIT Requesting', status: 'Allowed', active: true },
                          { name: 'Peer Approval', status: 'Disabled', active: false },
                          { name: 'User Management', status: 'Disabled', active: false },
                          { name: 'Security Auditing', status: 'Disabled', active: false },
                          { name: 'Portal Settings', status: 'Disabled', active: false }
                        ];
                    }
                  };
                  return getPrivs(user.role).map((p) => (
                    <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: p.active ? 'var(--text-main)' : 'var(--text-dim)' }}>{p.name}</span>
                      <span style={{ 
                        color: p.active ? 'var(--status-active)' : 'var(--text-dim)', 
                        fontWeight: p.active ? 600 : 400 
                      }}>{p.status}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>

        <div className="sidebar-footer" style={{ borderTop: '1px solid rgba(15, 23, 42, 0.06)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div className="profile-card" style={{ padding: '0.85rem 1rem', background: 'rgba(15, 23, 42, 0.015)', border: '1px solid rgba(15, 23, 42, 0.04)', borderRadius: '8px' }}>
            <span className="profile-title" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>Logged In User</span>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: '0.25rem' }}>
              <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-main)' }}>{user.name}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
              
              <span className="badge-clean" style={{
                alignSelf: 'flex-start',
                marginTop: '0.4rem',
                fontSize: '0.65rem',
                fontWeight: 800,
                padding: '0.15rem 0.45rem',
                borderRadius: '4px',
                background: user.role === 'ADMIN' ? 'var(--status-denied-bg)' : user.role === 'APPROVER' ? 'var(--status-pending-bg)' : user.role === 'AUDITOR' ? 'var(--status-expired-bg)' : 'var(--status-active-bg)',
                color: user.role === 'ADMIN' ? 'var(--status-denied)' : user.role === 'APPROVER' ? 'var(--status-pending)' : user.role === 'AUDITOR' ? 'var(--status-expired)' : 'var(--status-active)',
                border: '1px solid currentColor'
              }}>{user.role}</span>
            </div>

            {/* User Attributes Parameters display */}
            <div className="user-attributes-list" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.6rem', borderTop: '1px dashed rgba(15, 23, 42, 0.08)', paddingTop: '0.6rem' }}>
              {(user.attributes || []).map((attr) => (
                <span key={attr} style={{ 
                  background: attr === 'oncall' ? 'rgba(5, 150, 105, 0.06)' : 
                              attr === 'cdt' ? 'rgba(79, 70, 229, 0.06)' :
                              attr === 'security' ? 'rgba(8, 145, 178, 0.06)' :
                              'rgba(100, 116, 139, 0.06)', 
                  color: attr === 'oncall' ? 'var(--status-active)' : 
                         attr === 'cdt' ? 'var(--primary)' :
                         attr === 'security' ? 'var(--secondary)' :
                         'var(--status-expired)', 
                  border: '1px solid currentColor', 
                  padding: '0.1rem 0.3rem', 
                  borderRadius: '4px', 
                  fontSize: '0.65rem', 
                  fontWeight: 600 
                }}>{attr}</span>
              ))}
              {(!user.attributes || user.attributes.length === 0) && <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontStyle: 'italic' }}>No attributes</span>}
            </div>
          </div>

          <button 
            onClick={handleLogout} 
            className="clean-btn clean-btn-secondary" 
            style={{ width: '100%', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8rem', fontWeight: 600 }}
          >
            <LogOut size={12} />
            Sign Out
          </button>

          <div className={`mode-badge ${config?.mode === 'LIVE' ? 'live' : ''}`}>
            <Database size={12} />
            {config?.mode || 'MOCK'} ENGINE
          </div>
        </div>
      </aside>

      {/* Main Panel Viewport */}
      <main className="main-viewport">
        {activeView === 'users' ? (
          <>
            <header className="viewport-header">
              <div className="viewport-info">
                <h2>User Accounts Administration</h2>
                <p>Manage user credentials, roles, and eligibility parameters.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="clean-btn clean-btn-secondary"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  title="Refresh Data"
                  style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <RefreshCw size={14} className={isRefreshing ? 'spin-loader' : ''} />
                </button>
              </div>
            </header>
            <UserManagement currentUser={user} showToast={showToast} refreshTrigger={refreshTrigger} eligibleAttributes={config?.eligibleAttributes || []} />
          </>
        ) : activeView === 'docs' ? (
          <>
            <header className="viewport-header">
              <div className="viewport-info">
                <h2>Portal Documentation</h2>
                <p>Read setup guides, architecture details, and configuration instructions.</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="clean-btn clean-btn-secondary"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  title="Refresh Data"
                  style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <RefreshCw size={14} className={isRefreshing ? 'spin-loader' : ''} />
                </button>
              </div>
            </header>
            <Documentation />
          </>
        ) : (
          <>
            <header className="viewport-header">
              <div className="viewport-info">
                <h2>Access Command Center ({activeSpaceId === 'global' ? 'Global Config' : activeSpaceObj?.name})</h2>
                <p>Request and review temporary memberships in Workspace groups under {activeSpaceId === 'global' ? 'Global settings' : `Space: ${activeSpaceObj?.name}`}.</p>
              </div>
              
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="clean-btn clean-btn-secondary"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing}
                  title="Refresh Data"
                  style={{ padding: '0.6rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <RefreshCw size={14} className={isRefreshing ? 'spin-loader' : ''} />
                </button>
                {user.role === 'ADMIN' && (
                  <button className="clean-btn clean-btn-secondary" onClick={() => setShowSettings(true)}>
                    <Settings size={14} />
                    Settings
                  </button>
                )}
              </div>
            </header>

            {/* Metrics Row */}
            <section className="metrics-row">
              <div className="metric-card">
                <div className="metric-icon-wrapper" style={{ color: 'var(--status-active)' }}>
                  <Clock size={20} />
                </div>
                <div className="metric-details">
                  <span>Active Elevations</span>
                  <h3>{activeCount}</h3>
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-icon-wrapper" style={{ color: 'var(--status-pending)' }}>
                  <Users size={20} />
                </div>
                <div className="metric-details">
                  <span>Pending Review</span>
                  <h3>{pendingCount}</h3>
                </div>
              </div>

              <div className="metric-card">
                <div className="metric-icon-wrapper" style={{ color: 'var(--primary)' }}>
                  <ClipboardList size={20} />
                </div>
                <div className="metric-details">
                  <span>Total Requests</span>
                  <h3>{totalRequests}</h3>
                </div>
              </div>
            </section>

            {/* Grid Area: Request form left, Active elevations right */}
            <div className="dashboard-workspace-grid" style={(user.role === 'AUDITOR' || user.role === 'APPROVER') ? { gridTemplateColumns: '1fr' } : undefined}>
              {/* Left panel: JIT request form */}
              {!(user.role === 'AUDITOR' || user.role === 'APPROVER') && (
                <Request 
                  currentUser={user} 
                  showToast={showToast} 
                  onSuccess={fetchRequests} 
                  activeSpaceId={activeSpaceId}
                  activeSpacePolicies={activeSpacePolicies}
                />
              )}

              {/* Right panel: Active/Pending listings */}
              <Dashboard 
                currentUser={user} 
                requests={requests}
                fetchRequests={fetchRequests}
                showToast={showToast} 
                activeSpaceId={activeSpaceId}
                spaces={spaces}
              />
            </div>

            {/* Bottom Panel: History & Logs */}
            <section className="panel-card" style={{ marginTop: '0.5rem' }}>
              {(user.role === 'ADMIN' || user.role === 'AUDITOR') ? (
                <>
                  <div className="panel-header" style={{ borderBottom: 'none' }}>
                    <div className="tabs-navigation">
                      <button 
                        className={`tab-nav-item ${activeSubTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('history')}
                      >
                        My Elevation History
                      </button>
                      <button 
                        className={`tab-nav-item ${activeSubTab === 'logs' ? 'active' : ''}`}
                        onClick={() => setActiveSubTab('logs')}
                      >
                        Central Security Audit Trail
                      </button>
                    </div>
                  </div>

                  <div className="panel-body" style={{ paddingTop: 0 }}>
                    {activeSubTab === 'history' ? (
                      <DashboardHistory currentUser={user} requests={requests} activeSpaceId={activeSpaceId} spaces={spaces} />
                    ) : (
                      <AuditTrailView showToast={showToast} refreshTrigger={refreshTrigger} />
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="panel-header">
                    <h3>
                      <ClipboardList className="logo-icon" size={16} />
                      My Elevation History
                    </h3>
                  </div>
                  <div className="panel-body">
                    <DashboardHistory currentUser={user} requests={requests} activeSpaceId={activeSpaceId} spaces={spaces} />
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </main>

      {/* Settings Modal Overlay */}
      {showSettings && user.role === 'ADMIN' && (
        <SettingsView 
          showToast={showToast} 
          onConfigUpdated={() => { fetchConfig(); fetchSpaces(); }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* Alert toast notifications */}
      {toast && (
        <div className="clean-toast" style={{
          borderColor: toast.type === 'error' ? 'var(--status-denied)' : 
                       toast.type === 'info' ? 'var(--secondary)' : 
                       'var(--status-active)'
        }}>
          {toast.type === 'error' ? <span style={{ color: 'var(--status-denied)' }}>●</span> : 
           toast.type === 'info' ? <span style={{ color: 'var(--secondary)' }}>●</span> : 
           <span style={{ color: 'var(--status-active)' }}>●</span>}
          {toast.message}
        </div>
      )}
    </div>
  );
}

// Subcomponent to list history
function DashboardHistory({ currentUser, requests, activeSpaceId, spaces }: { currentUser: User; requests: JitRequest[]; activeSpaceId: string; spaces: SpaceConfig[] }) {
  const userRequests = requests.filter(r => r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase());
  const spaceRequests = userRequests.filter(r => {
    if (activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });
  const historyRequests = spaceRequests.filter(r => r.status !== 'ACTIVE');

  const renderStatus = (status: JitRequest['status']) => {
    return <span className={`badge-clean badge-clean-${status.toLowerCase()}`}>{status}</span>;
  };

  if (historyRequests.length === 0) {
    return (
      <div className="empty-view">
        <ClipboardList size={28} />
        <p>No historical JIT requests found for your profile in this Space.</p>
      </div>
    );
  }

  return (
    <div className="aesthetic-table-wrapper">
      <table className="aesthetic-table">
        <thead>
          <tr>
            <th>Group Name</th>
            <th>Requested Date</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Reason / Details</th>
          </tr>
        </thead>
        <tbody>
          {historyRequests.map(req => (
            <tr key={req.id}>
              <td style={{ fontWeight: 600 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {req.groupName}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '9999px',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    background: 'rgba(79, 70, 229, 0.08)',
                    border: '1px solid rgba(79, 70, 229, 0.15)',
                    color: 'var(--primary)'
                  }}>
                    {spaces.find(s => s.id === req.spaceId)?.name || 'Global Config'}
                  </span>
                </div>
              </td>
              <td style={{ color: 'var(--text-muted)' }}>{new Date(req.requestedAt).toLocaleString()}</td>
              <td style={{ color: 'var(--text-muted)' }}>{req.durationMinutes}m</td>
              <td>{renderStatus(req.status)}</td>
              <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {req.status === 'DENIED' ? `Denied by ${req.approverEmail}` : req.justification}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTrailView({ showToast, refreshTrigger }: { showToast: any; refreshTrigger: any }) {
  interface AuditLog {
    id: string;
    timestamp: string;
    actor: string;
    action: string;
    details: string;
  }

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = async () => {
    const activeToken = localStorage.getItem('jit_token');
    if (!activeToken) return;
    try {
      const res = await fetch('/api/logs', {
        headers: { 'Authorization': `Bearer ${activeToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      } else {
        showToast("Access Denied. You do not have permissions to view audit logs.", "error");
      }
    } catch (err) {
      showToast("Failed to fetch logs.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [refreshTrigger]);

  const renderLogAction = (action: string) => {
    let cls = 'action-system';
    if (action.includes('REQUEST')) cls = 'action-request';
    if (action.includes('APPROVE')) cls = 'action-approve';
    if (action.includes('DENY')) cls = 'action-deny';
    if (action.includes('REVOKE')) cls = 'action-revoke';
    
    return <span className={`log-action-badge ${cls}`}>{action.replace('_', ' ')}</span>;
  };

  if (loading) {
    return <div className="empty-view">Retrieving audit logs...</div>;
  }

  if (logs.length === 0) {
    return (
      <div className="empty-view">
        <ClipboardList size={28} />
        <p>No audit logs recorded in the system.</p>
      </div>
    );
  }

  return (
    <div className="aesthetic-table-wrapper" style={{ maxHeight: '350px', overflowY: 'auto' }}>
      <table className="aesthetic-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(log => (
            <tr key={log.id}>
              <td style={{ whiteSpace: 'nowrap', color: 'var(--text-dim)' }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </td>
              <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                {log.actor.split('@')[0]}
              </td>
              <td>
                {renderLogAction(log.action)}
              </td>
              <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {log.details}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
