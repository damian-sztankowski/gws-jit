import { useState, useEffect } from 'react';
import { Clock, Loader2, AlertTriangle, Zap } from 'lucide-react';
import { WorkspaceGroup, User, GroupJitPolicy } from '../types.ts';
import { getAuthHeaders } from '../api.ts';

interface RequestProps {
  currentUser: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onSuccess: () => void;
  activeSpaceId: string;
  activeSpacePolicies: GroupJitPolicy[];
  onEligibleCountChange?: (count: number) => void;
}

export default function Request({
  currentUser,
  showToast,
  onSuccess,
  activeSpaceId,
  activeSpacePolicies,
  onEligibleCountChange
}: RequestProps) {
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [justification, setJustification] = useState<string>('');
  const [ticketId, setTicketId] = useState<string>('');
  const [isBreakGlass, setIsBreakGlass] = useState<boolean>(false);
  const [duration, setDuration] = useState<number>(60);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const userMatchesPolicy = (user: User, policy: GroupJitPolicy) => {
    if (!policy.requiredAttributes || policy.requiredAttributes.length === 0) return true;
    const userAttrs = user.attributes || [];
    return policy.requiredAttributes.every((attr) => userAttrs.includes(attr));
  };

  const loadInitialData = async () => {
    setLoading(true);
    try {
      const groupsRes = await fetch('/api/groups', {
        headers: getAuthHeaders()
      });
      const groupsData = await groupsRes.json();
      setGroups(groupsRes.ok ? groupsData : []);
    } catch {
      showToast('Failed to load Workspace groups.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, [activeSpaceId]);

  const userEligibleGroupEmails = activeSpacePolicies
    .filter((policy: GroupJitPolicy) => userMatchesPolicy(currentUser, policy))
    .map((policy: GroupJitPolicy) => policy.groupEmail.toLowerCase());

  const eligibleGroups = groups.filter((g: WorkspaceGroup) =>
    userEligibleGroupEmails.includes(g.email.toLowerCase())
  );

  useEffect(() => {
    onEligibleCountChange?.(eligibleGroups.length);
    if (eligibleGroups.length > 0) {
      const stillValid = eligibleGroups.some(
        (g) => g.email.toLowerCase() === selectedGroup.toLowerCase()
      );
      if (!stillValid) {
        setSelectedGroup(eligibleGroups[0].email);
      }
    } else {
      setSelectedGroup('');
    }
  }, [groups, activeSpacePolicies, currentUser]);

  const selectedPolicy = activeSpacePolicies.find(
    (p) => p.groupEmail.toLowerCase() === selectedGroup.toLowerCase()
  );
  const maxDuration = selectedPolicy?.maxDurationMinutes || 240;
  const userCanBreakGlass =
    Boolean(selectedPolicy?.allowBreakGlass) &&
    (currentUser.role === 'ADMIN' || (currentUser.attributes || []).includes('oncall'));

  useEffect(() => {
    if (!userCanBreakGlass && isBreakGlass) {
      setIsBreakGlass(false);
    }
    if (duration > maxDuration) {
      setDuration(maxDuration);
    }
  }, [selectedGroup, maxDuration, userCanBreakGlass]);

  const handleToggleBreakGlass = (checked: boolean) => {
    setIsBreakGlass(checked);
    if (checked) {
      setDuration(30);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup || !justification.trim() || !duration) {
      showToast('Complete all required fields.', 'error');
      return;
    }
    if (isBreakGlass && ticketId.trim().length < 3) {
      showToast('Incident or ticket reference is mandatory for break-glass.', 'error');
      return;
    }

    setSubmitting(true);
    const groupObj = groups.find((g) => g.email === selectedGroup);

    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({
          groupEmail: selectedGroup,
          groupName: groupObj?.name || selectedGroup,
          justification,
          ticketId: ticketId.trim() || undefined,
          isBreakGlass,
          durationMinutes: isBreakGlass ? 30 : duration,
          spaceId: activeSpaceId === 'global' ? undefined : activeSpaceId
        })
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showToast(
          data.request.status === 'ACTIVE'
            ? isBreakGlass
              ? `Break-glass grant active on ${groupObj?.name || selectedGroup} (30m).`
              : `Provisioned access to ${groupObj?.name || selectedGroup}.`
            : 'Request queued for custody approval.',
          'success'
        );
        setJustification('');
        setTicketId('');
        setIsBreakGlass(false);
        onSuccess();
      } else {
        showToast(data.error || 'Failed to submit elevation request.', 'error');
      }
    } catch {
      showToast('Unable to reach server.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 size={16} className="spin" />
        <span>Querying directory groups...</span>
      </div>
    );
  }

  const isOverdue = Boolean(
    selectedPolicy?.attestationDueAt && new Date(selectedPolicy.attestationDueAt) < new Date()
  );
  const requiresTwoPeers =
    (selectedPolicy?.requiredApprovals || 1) >= 2 && !selectedPolicy?.autoApproval;

  return (
    <div>
      <div style={{ marginBottom: '1.15rem' }}>
        <div className="eyebrow">Privilege Request</div>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginTop: '0.15rem' }}>
          New directory elevation
        </h3>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <div className="field-label-row">
            <label className="field-label">Target Workspace group</label>
            <span className="field-hint tabular">{eligibleGroups.length} eligible</span>
          </div>

          {eligibleGroups.length === 0 ? (
            <div className="callout callout--warn">
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                Zero groups match your assigned ABAC tags in this scope. Contact an administrator.
              </span>
            </div>
          ) : (
            <div className="group-radio-list" role="radiogroup" aria-label="Eligible Workspace groups">
              {eligibleGroups.map((g) => {
                const active = g.email === selectedGroup;
                const pol = activeSpacePolicies.find(
                  (p) => p.groupEmail.toLowerCase() === g.email.toLowerCase()
                );
                const twoPeers = (pol?.requiredApprovals || 1) >= 2 && !pol?.autoApproval;
                return (
                  <button
                    key={g.email}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`group-radio-card ${active ? 'group-radio-card--active' : ''}`}
                    onClick={() => setSelectedGroup(g.email)}
                  >
                    <span className="group-radio-indicator" />
                    <div className="group-radio-body">
                      <div className="group-radio-head">
                        <span className="group-radio-name">{g.name}</span>
                        {pol?.autoApproval ? (
                          <span className="pill pill-active">AUTO</span>
                        ) : twoPeers ? (
                          <span className="pill pill-pending">2-PEER</span>
                        ) : null}
                      </div>
                      <div className="group-radio-email">{g.email}</div>
                      {g.description && (
                        <div className="group-radio-desc">{g.description}</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {isOverdue && (
            <div className="callout callout--warn" style={{ marginTop: '0.35rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>
                Policy attestation is overdue. Recertify under <strong>Policies & Spaces</strong>.
              </span>
            </div>
          )}
        </div>

        {userCanBreakGlass && eligibleGroups.length > 0 && (
          <div className="field">
            <div
              className="toggle-row"
              style={
                isBreakGlass
                  ? { background: 'var(--crimson-bg)', borderColor: 'var(--crimson-border)' }
                  : undefined
              }
            >
              <div>
                <div
                  className="toggle-row-title"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <Zap
                    size={13}
                    style={{ color: isBreakGlass ? 'var(--crimson-ink)' : 'var(--ink-500)' }}
                  />
                  Emergency break-glass
                </div>
                <div className="toggle-row-desc">
                  Immediate 30m P0 grant — bypasses quorum & triggers security alert
                </div>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={isBreakGlass}
                  onChange={(e) => handleToggleBreakGlass(e.target.checked)}
                />
                <span className="switch-track" />
              </label>
            </div>
          </div>
        )}

        <div className="field">
          <div className="field-label-row">
            <label className="field-label">Lease TTL</label>
            <span className="field-hint tabular" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Clock size={11} />
              {isBreakGlass ? 'Fixed 30m' : `Max ${maxDuration}m`}
            </span>
          </div>
          <div className="segmented segmented--full" role="group" aria-label="Activation duration">
            {[30, 60, 120, 240].map((mins) => {
              const disabled =
                eligibleGroups.length === 0 ||
                (isBreakGlass && mins !== 30) ||
                mins > maxDuration;
              const active = (isBreakGlass ? 30 : duration) === mins;
              return (
                <button
                  key={mins}
                  type="button"
                  className={`segmented-btn tabular ${active ? 'active' : ''}`}
                  disabled={disabled}
                  onClick={() => setDuration(mins)}
                >
                  {mins < 60 ? `${mins}m` : `${mins / 60}h`}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label htmlFor="ticketId" className="field-label">
            {isBreakGlass ? 'Incident / change ID (required)' : 'Ticket / change ID'}
          </label>
          <input
            id="ticketId"
            type="text"
            className="input text-mono"
            placeholder="INC-4821 / CHG-902"
            maxLength={64}
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
            disabled={eligibleGroups.length === 0}
            required={isBreakGlass}
          />
        </div>

        <div className="field">
          <div className="field-label-row">
            <label htmlFor="justification" className="field-label">Operational justification</label>
            <span className="field-hint tabular">{justification.length}/300</span>
          </div>
          <textarea
            id="justification"
            className="textarea"
            rows={3}
            placeholder="Specify the administrative task requiring temporary elevation..."
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            maxLength={300}
            disabled={eligibleGroups.length === 0}
            required
          />
        </div>

        <div className="stack-sm" style={{ marginTop: '1.25rem' }}>
          <button
            type="submit"
            className={`btn ${isBreakGlass ? 'btn-danger-solid' : 'btn-cobalt'} btn-block`}
            disabled={
              submitting ||
              !justification.trim() ||
              eligibleGroups.length === 0 ||
              (isBreakGlass && ticketId.trim().length < 3)
            }
          >
            {submitting ? (
              <>
                <Loader2 size={14} className="spin" />
                Provisioning...
              </>
            ) : isBreakGlass ? (
              <>
                <Zap size={14} />
                Invoke 30m break-glass
              </>
            ) : (
              'Submit elevation request'
            )}
          </button>

          <p className="field-hint" style={{ fontSize: '0.71rem', textAlign: 'center', marginTop: '0.15rem' }}>
            {isBreakGlass
              ? 'Recorded under BREAK_GLASS_JIT and broadcast to security webhooks.'
              : selectedPolicy?.autoApproval
                ? 'Policy pre-approved — group membership activates immediately.'
                : requiresTwoPeers
                  ? 'Tier-0 policy — requires 2 distinct peer approvals prior to activation.'
                  : 'Dual-custody — requires independent peer authorization.'}
          </p>
        </div>
      </form>
    </div>
  );
}
