import { useState, useEffect } from 'react';
import { Shield, Clock, HelpCircle, Loader2, ShieldAlert } from 'lucide-react';
import { WorkspaceGroup, User, GroupJitPolicy } from '../types.ts';

interface RequestProps {
  currentUser: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSuccess: () => void;
  activeSpaceId: string;
  activeSpacePolicies: GroupJitPolicy[];
}

export default function Request({ currentUser, showToast, onSuccess, activeSpaceId, activeSpacePolicies }: RequestProps) {
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [justification, setJustification] = useState<string>('');
  const [duration, setDuration] = useState<number>(60); // Default 60 minutes
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const userMatchesPolicy = (user: User, policy: GroupJitPolicy) => {
    if (!policy.requiredAttributes || policy.requiredAttributes.length === 0) return true;
    const userAttrs = user.attributes || [];
    return policy.requiredAttributes.every(attr => userAttrs.includes(attr));
  };

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const groupsRes = await fetch('/api/groups', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const groupsData = await groupsRes.json();
      setGroups(groupsRes.ok ? groupsData : []);
    } catch (err) {
      showToast("Failed to initialize request form.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [activeSpaceId]); // Reload groups when active space changes

  useEffect(() => {
    // Recalculate and auto-select first eligible group when policies or groups reload
    const userEligibleGroupEmails = activeSpacePolicies
      .filter((policy: GroupJitPolicy) => userMatchesPolicy(currentUser, policy))
      .map((policy: GroupJitPolicy) => policy.groupEmail.toLowerCase());

    const filtered = groups.filter((g: WorkspaceGroup) => 
      userEligibleGroupEmails.includes(g.email.toLowerCase())
    );

    if (filtered.length > 0) {
      setSelectedGroup(filtered[0].email);
    } else {
      setSelectedGroup('');
    }
  }, [groups, activeSpacePolicies, currentUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !justification.trim() || !duration) {
      showToast("Please fill in all fields.", "error");
      return;
    }

    setSubmitting(true);
    const groupObj = groups.find(g => g.email === selectedGroup);

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        },
        body: JSON.stringify({
          groupEmail: selectedGroup,
          groupName: groupObj?.name || selectedGroup,
          justification,
          durationMinutes: duration,
          spaceId: activeSpaceId === 'global' ? undefined : activeSpaceId
        })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        showToast(
          data.request.status === 'ACTIVE' 
            ? `Membership granted! You are now added to ${groupObj?.name}.`
            : "Membership request submitted. Awaiting peer approval.",
          "success"
        );
        setJustification('');
        onSuccess();
      } else {
        showToast(data.error || "Failed to submit request.", "error");
      }
    } catch (err) {
      showToast("Error communicating with server.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="panel-card" style={{ padding: '3rem', textAlign: 'center' }}>
        <Loader2 className="logo-icon spin-loader" size={24} style={{ margin: '0 auto' }} />
        <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>Retrieving Workspace Groups...</p>
      </div>
    );
  }

  // Filter groups using ABAC policy logic
  const userEligibleGroupEmails = activeSpacePolicies
    .filter(policy => userMatchesPolicy(currentUser, policy))
    .map(policy => policy.groupEmail.toLowerCase());

  const eligibleGroups = groups.filter(g => 
    userEligibleGroupEmails.includes(g.email.toLowerCase())
  );
  const selectedGroupObj = eligibleGroups.find(g => g.email === selectedGroup);

  return (
    <section className="panel-card">
      <div className="panel-header">
        <h3>
          <Shield className="logo-icon" size={16} />
          Request Temporary Membership
        </h3>
      </div>
      <div className="panel-body">
        <form onSubmit={handleSubmit}>
          
          {/* Target Group */}
          <div className="form-input-group">
            <label htmlFor="group">Eligible Workspace Group</label>
            {eligibleGroups.length === 0 ? (
              <div className="alert-clean" style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.15)', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <ShieldAlert size={14} style={{ color: 'var(--status-denied)', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  No Workspace groups match your current security attributes. Contact your Admin.
                </span>
              </div>
            ) : (
              <>
                <select
                  id="group"
                  className="clean-control"
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                >
                  {eligibleGroups.map(g => (
                    <option key={g.email} value={g.email}>
                      {g.name}
                    </option>
                  ))}
                </select>
                {selectedGroupObj?.description && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.25rem', lineHeight: '1.3' }}>
                    {selectedGroupObj.description}
                  </p>
                )}
                {(() => {
                  const policy = activeSpacePolicies.find(p => p.groupEmail.toLowerCase() === selectedGroup.toLowerCase());
                  const isOverdue = policy?.attestationDueAt && new Date(policy.attestationDueAt) < new Date();
                  if (!isOverdue) return null;
                  return (
                    <div className="alert-clean" style={{ background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.2)', display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.5rem', border: '1px solid', padding: '0.5rem', borderRadius: '6px' }}>
                      <ShieldAlert size={14} style={{ color: '#d97706', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ⚠️ Policy Access Review is Overdue. This JIT configuration requires administrator recertification.
                      </span>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Duration Selector */}
          <div className="form-input-group" style={{ marginTop: '1.25rem' }}>
            <label>Activation Duration</label>
            <div className="duration-grid">
              {[30, 60, 120, 240].map(mins => (
                <button
                  key={mins}
                  type="button"
                  className={`duration-chip ${duration === mins ? 'active' : ''}`}
                  disabled={eligibleGroups.length === 0}
                  onClick={() => setDuration(mins)}
                >
                  {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.6rem' }}>
              <Clock size={12} style={{ color: 'var(--text-dim)' }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Your membership will be automatically deleted after {duration} minutes.
              </span>
            </div>
          </div>

          {/* Justification Text Area */}
          <div className="form-input-group" style={{ marginTop: '1.25rem' }}>
            <label htmlFor="justification">Business Justification</label>
            <textarea
              id="justification"
              className="clean-control"
              rows={4}
              placeholder="Explain why you require elevated access (e.g. Group management auditing, troubleshooting SSO settings)..."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              maxLength={300}
              disabled={eligibleGroups.length === 0}
              required
            />
            <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textAlign: 'right', marginTop: '0.1rem' }}>
              {justification.length}/300 characters
            </p>
          </div>

          {/* Submit Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
            <button
              type="submit"
              className="clean-btn clean-btn-primary"
              disabled={submitting || !justification.trim() || eligibleGroups.length === 0}
              style={{ width: '100%', padding: '0.8rem' }}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="spin-loader" />
                  Adding to Group...
                </>
              ) : (
                "Submit Request"
              )}
            </button>
            
            <div className="alert-clean">
              <HelpCircle size={14} style={{ color: 'var(--secondary)', flexShrink: 0, marginTop: '0.05rem' }} />
              <span>
                Dual-custody checks are in place. An independent administrator must review and approve this temporary membership assignment.
              </span>
            </div>
          </div>
        </form>
      </div>
    </section>
  );
}
