import { useState, useEffect } from 'react';
import { Clock, ShieldAlert, Check, X, Shield, Trash2 } from 'lucide-react';
import { JitRequest, User, SpaceConfig } from '../types.ts';

interface DashboardProps {
  currentUser: User;
  requests: JitRequest[];
  fetchRequests: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  activeSpaceId?: string;
  spaces: SpaceConfig[];
}

// Countdown clock component
function Countdown({ expiresAt, onExpired }: { expiresAt: string; onExpired: () => void }) {
  const calculateTimeLeft = () => {
    const difference = +new Date(expiresAt) - +new Date();
    return difference > 0 ? difference : 0;
  };

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft());

  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onExpired();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiresAt]);

  const hours = Math.floor(timeLeft / (1000 * 60 * 60));
  const minutes = Math.floor((timeLeft / 1000 / 60) % 60);
  const seconds = Math.floor((timeLeft / 1000) % 60);

  const formatNumber = (num: number) => String(num).padStart(2, '0');

  return (
    <div className="active-clock">
      <Clock size={12} />
      <span>
        {hours > 0 ? `${formatNumber(hours)}:` : ''}
        {formatNumber(minutes)}:{formatNumber(seconds)}
      </span>
    </div>
  );
}

export default function Dashboard({ currentUser, requests, fetchRequests, showToast, activeSpaceId, spaces }: DashboardProps) {
  // 1. Active Requests: 
  // - If the user is a REQUESTER, show all of their own active requests regardless of space.
  // - If the user is ADMIN, APPROVER, or AUDITOR, filter active requests by the selected activeSpaceId.
  const activeRequests = requests.filter(r => {
    if (r.status !== 'ACTIVE') return false;
    if (currentUser.role === 'REQUESTER') {
      return r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase();
    }
    if (!activeSpaceId || activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });

  // 2. Pending Requests:
  // - If the user is an ADMIN or APPROVER, show ALL pending requests across all spaces (unfiltered by activeSpaceId).
  // - If the user is a REQUESTER, show all of their own pending requests across all spaces.
  // - If the user is an AUDITOR, filter pending requests by the activeSpaceId (standard behavior).
  const pendingRequests = requests.filter(r => {
    if (r.status !== 'PENDING') return false;
    
    if (currentUser.role === 'ADMIN' || currentUser.role === 'APPROVER') {
      return true; // Visible regardless of the picked space
    }
    
    if (currentUser.role === 'REQUESTER') {
      return r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase(); // All their own requests regardless of space
    }
    
    // Auditor: standard space filtering
    if (!activeSpaceId || activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Membership revoked early.", "success");
        await fetchRequests();
      } else {
        showToast(data.error || "Failed to revoke membership.", "error");
      }
    } catch (err) {
      showToast("Error communicating with server.", "error");
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Request approved. User added to Workspace Group.", "success");
        await fetchRequests();
      } else {
        showToast(data.error || "Failed to approve request.", "error");
      }
    } catch (err) {
      showToast("Server error during approval.", "error");
    }
  };

  const handleDeny = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}/deny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Access request denied.", "success");
        await fetchRequests();
      } else {
        showToast(data.error || "Failed to deny request.", "error");
      }
    } catch (err) {
      showToast("Server error during denial.", "error");
    }
  };

  const isAuthorizedToApprove = currentUser.role === 'ADMIN' || currentUser.role === 'APPROVER';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Active Temporary Permissions Card */}
      <section className="panel-card">
        <div className="panel-header">
          <h3>
            <Clock className="logo-icon" size={16} />
            Active JIT Group Sessions
          </h3>
          <span className="badge-clean badge-clean-active">{activeRequests.length} Active</span>
        </div>
        <div className="panel-body">
          {activeRequests.length === 0 ? (
            <div className="empty-view">
              <Shield size={28} />
              <p>No active temporary permissions. Your account has standard user privileges.</p>
            </div>
          ) : (
            <div className="jit-deck">
              {activeRequests.map(req => {
                const canRevoke = req.requesterEmail === currentUser.email || currentUser.role === 'ADMIN' || currentUser.role === 'APPROVER';
                return (
                  <div key={req.id} className="jit-elevation-item">
                    <div className="jit-item-header">
                      <div className="jit-title">
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                          <h4>{req.groupName}</h4>
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
                        <div className="jit-info-sub">
                          <span>User: <strong>{req.requesterEmail.split('@')[0]}</strong></span>
                          <span>Approver: {req.approverEmail?.split('@')[0]}</span>
                        </div>
                      </div>
                      
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <Countdown expiresAt={req.expiresAt!} onExpired={fetchRequests} />
                        {canRevoke && (
                          <button 
                            className="clean-btn clean-btn-danger"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                            onClick={() => handleRevoke(req.id)}
                          >
                            <Trash2 size={12} />
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <div className="jit-reason">
                      <strong>Justification:</strong> {req.justification}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Peer Approvals Review Card */}
      <section className="panel-card">
        <div className="panel-header">
          <h3>
            <Shield className="logo-icon" size={16} />
            Pending Peer Approvals
          </h3>
          <span className="badge-clean badge-clean-pending">{pendingRequests.length} Review</span>
        </div>
        <div className="panel-body">
          {pendingRequests.length === 0 ? (
            <div className="empty-view">
              <Check size={28} style={{ color: 'var(--status-active)' }} />
              <p>All reviews are clean! No pending requests require authorization.</p>
            </div>
          ) : (
            <div className="jit-deck">
              {pendingRequests.map(req => {
                const isSelfRequest = req.requesterEmail === currentUser.email;
                return (
                  <div key={req.id} className="review-item">
                    <div className="jit-item-header">
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                          <h4>{req.groupName}</h4>
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
                        <div className="jit-info-sub">
                          <span>User: <strong>{req.requesterEmail}</strong></span>
                          <span>Duration: {req.durationMinutes}m</span>
                        </div>
                      </div>

                      {isSelfRequest ? (
                        <div className="alert-clean" style={{ padding: '0.3rem 0.5rem', border: 'none', background: 'transparent' }}>
                          <ShieldAlert size={14} style={{ color: 'var(--status-pending)', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.75rem', color: 'var(--status-pending)', fontWeight: 600 }}>Self-Request</span>
                        </div>
                      ) : isAuthorizedToApprove ? (
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            className="clean-btn clean-btn-success"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                            onClick={() => handleApprove(req.id)}
                          >
                            <Check size={12} />
                            Approve
                          </button>
                          <button
                            className="clean-btn clean-btn-danger"
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                            onClick={() => handleDeny(req.id)}
                          >
                            <X size={12} />
                            Deny
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                          Requires Approver role
                        </span>
                      )}
                    </div>
                    
                    <div className="jit-reason">
                      <strong>Business justification:</strong> {req.justification}
                    </div>

                    {isSelfRequest && (
                      <div className="alert-clean" style={{ marginTop: '0.3rem' }}>
                        <ShieldAlert size={14} style={{ color: 'var(--status-pending)', flexShrink: 0, marginTop: '0.05rem' }} />
                        <span>Self-approval is blocked. Let another independent administrator approve this request.</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
