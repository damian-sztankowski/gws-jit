import { useState, useEffect } from 'react';
import { Clock, Check, X, Plus, Zap } from 'lucide-react';
import { JitRequest, User, SpaceConfig, GroupJitPolicy } from '../types.ts';
import { getAuthHeaders } from '../api.ts';
import { Modal, ConfirmDialog } from './Modal.tsx';

interface DashboardProps {
  currentUser: User;
  requests: JitRequest[];
  fetchRequests: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  activeSpaceId?: string;
  spaces: SpaceConfig[];
  globalPolicies?: GroupJitPolicy[];
}

function SessionTimer({
  expiresAt,
  durationMinutes,
  onExpired
}: {
  expiresAt: string;
  durationMinutes: number;
  onExpired: () => void;
}) {
  const computeRemaining = () => {
    const diff = +new Date(expiresAt) - Date.now();
    return diff > 0 ? diff : 0;
  };

  const [remainingMs, setRemainingMs] = useState(computeRemaining);

  useEffect(() => {
    const timer = setInterval(() => {
      const next = computeRemaining();
      setRemainingMs(next);
      if (next <= 0) {
        clearInterval(timer);
        onExpired();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const totalMs = Math.max(durationMinutes * 60 * 1000, 1);
  const pct = Math.min(100, Math.max(0, (remainingMs / totalMs) * 100));
  const remainingMins = remainingMs / 60000;

  const hours = Math.floor(remainingMs / 3600000);
  const minutes = Math.floor((remainingMs / 60000) % 60);
  const seconds = Math.floor((remainingMs / 1000) % 60);
  const pad = (n: number) => String(n).padStart(2, '0');

  const urgencyClass =
    remainingMins <= 5 ? 'urgent' : remainingMins <= 15 ? 'warn' : '';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%' }}>
      <div className="ttl-track" aria-hidden="true" style={{ flex: 1 }}>
        <div
          className={`ttl-fill ${urgencyClass ? `ttl-fill--${urgencyClass}` : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`countdown-pill ${urgencyClass ? `countdown-pill--${urgencyClass}` : ''}`}
        title="Remaining lease TTL"
      >
        <Clock size={11} />
        {hours > 0 ? `${pad(hours)}:` : ''}
        {pad(minutes)}:{pad(seconds)}
      </span>
    </div>
  );
}

export default function Dashboard({
  currentUser,
  requests,
  fetchRequests,
  showToast,
  activeSpaceId,
  spaces,
  globalPolicies = []
}: DashboardProps) {
  const [revokeTarget, setRevokeTarget] = useState<JitRequest | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);

  const [reviewModal, setReviewModal] = useState<{
    request: JitRequest;
    action: 'approve' | 'deny';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const activeRequests = requests.filter((r) => {
    if (r.status !== 'ACTIVE') return false;
    if (currentUser.role === 'REQUESTER') {
      return r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase();
    }
    if (!activeSpaceId || activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });

  const pendingRequests = requests.filter((r) => {
    if (r.status !== 'PENDING') return false;
    if (currentUser.role === 'ADMIN' || currentUser.role === 'APPROVER') {
      return true;
    }
    if (currentUser.role === 'REQUESTER') {
      return r.requesterEmail.toLowerCase() === currentUser.email.toLowerCase();
    }
    if (!activeSpaceId || activeSpaceId === 'global') {
      return !r.spaceId;
    }
    return r.spaceId === activeSpaceId;
  });

  const resolvePolicyMaxDuration = (req: JitRequest): number => {
    const policies = req.spaceId
      ? spaces.find((s) => s.id === req.spaceId)?.groupPolicies || []
      : globalPolicies;
    const matched = policies.find(
      (p) => p.groupEmail.toLowerCase() === req.groupEmail.toLowerCase()
    );
    return matched?.maxDurationMinutes || 240;
  };

  const handleRevoke = async (id: string) => {
    try {
      const res = await fetch(`/api/requests/${id}/revoke`, {
        method: 'POST',
        headers: getAuthHeaders(true)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Directory membership revoked.', 'success');
        await fetchRequests();
      } else {
        showToast(data.error || 'Revocation failed.', 'error');
      }
    } catch {
      showToast('Error communicating with server.', 'error');
    } finally {
      setRevokeTarget(null);
    }
  };

  const handleExtend = async (id: string) => {
    setExtendingId(id);
    try {
      const res = await fetch(`/api/requests/${id}/extend`, {
        method: 'POST',
        headers: getAuthHeaders(true)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Lease extended by +30m.', 'success');
        await fetchRequests();
      } else {
        showToast(data.error || 'Failed to extend lease.', 'error');
      }
    } catch {
      showToast('Error extending lease.', 'error');
    } finally {
      setExtendingId(null);
    }
  };

  const submitReviewDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModal) return;
    setReviewSubmitting(true);

    const { request, action } = reviewModal;
    try {
      const res = await fetch(`/api/requests/${request.id}/${action}`, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({
          reviewNote: reviewNote.trim() || undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (action === 'approve') {
          showToast(
            data.quorumPending
              ? 'Recorded 1/2 peer approvals. Awaiting second independent reviewer.'
              : 'Approved and provisioned in Workspace directory.',
            'success'
          );
        } else {
          showToast('Elevation request denied.', 'info');
        }
        setReviewModal(null);
        setReviewNote('');
        await fetchRequests();
      } else {
        showToast(data.error || `Failed to ${action} request.`, 'error');
      }
    } catch {
      showToast('Server error during review.', 'error');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const isAuthorizedToApprove =
    currentUser.role === 'ADMIN' || currentUser.role === 'APPROVER';

  const resolveSpaceLabel = (spaceId?: string) =>
    spaces.find((s) => s.id === spaceId)?.name || 'Global';

  return (
    <>
      {/* Block 1: Active Directory Grants */}
      <section className="feed-block">
        <div className="block-header">
          <div>
            <h3 className="card-title">Active directory grants</h3>
            <p className="card-subtitle">Live group memberships scheduled for automatic revocation</p>
          </div>
          <span className={`pill ${activeRequests.length > 0 ? 'pill-active' : 'pill-neutral'} tabular`}>
            {activeRequests.length > 0 && <span className="pill-dot" />}
            {activeRequests.length} ACTIVE
          </span>
        </div>

        {activeRequests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">Zero standing elevations</div>
            <span>All operator accounts are operating at baseline privileges.</span>
          </div>
        ) : (
          <div className="queue-list">
            {activeRequests.map((req) => {
              const isOwner =
                req.requesterEmail.toLowerCase() === currentUser.email.toLowerCase();
              const canRevoke =
                isOwner ||
                currentUser.role === 'ADMIN' ||
                currentUser.role === 'APPROVER';
              const maxAllowed = resolvePolicyMaxDuration(req);
              const canExtend =
                !req.isBreakGlass &&
                (isOwner || currentUser.role === 'ADMIN') &&
                (req.extendedCount || 0) < 2 &&
                req.durationMinutes + 30 <= maxAllowed;

              return (
                <div key={req.id} className="session-row">
                  <div className="session-top">
                    <div>
                      <div className="session-title-row">
                        <span className="session-group">{req.groupName}</span>
                        <span className="pill pill-neutral">{resolveSpaceLabel(req.spaceId)}</span>
                        {req.isBreakGlass && (
                          <span className="pill pill-denied">
                            <Zap size={10} />
                            BREAK-GLASS
                          </span>
                        )}
                        {req.ticketId && (
                          <span className="tag-chip">{req.ticketId}</span>
                        )}
                      </div>
                      <div className="session-meta">
                        <span>Principal: <code className="text-mono">{req.requesterEmail}</code></span>
                        {req.approverEmail && (
                          <span>Authorized: <code className="text-mono">{req.approverEmail}</code></span>
                        )}
                      </div>
                    </div>

                    <div className="session-actions">
                      {canExtend && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm tabular"
                          disabled={extendingId === req.id}
                          onClick={() => handleExtend(req.id)}
                          title="Extend lease by 30 minutes"
                        >
                          <Plus size={12} />
                          30m
                        </button>
                      )}
                      {canRevoke && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => setRevokeTarget(req)}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="session-reason">{req.justification}</div>

                  {req.expiresAt && (
                    <SessionTimer
                      expiresAt={req.expiresAt}
                      durationMinutes={req.durationMinutes}
                      onExpired={fetchRequests}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Block 2: Custody Approval Queue */}
      <section className="feed-block">
        <div className="block-header">
          <div>
            <h3 className="card-title">Custody approval queue</h3>
            <p className="card-subtitle">Requests awaiting independent peer verification</p>
          </div>
          <span className={`pill ${pendingRequests.length > 0 ? 'pill-pending' : 'pill-neutral'} tabular`}>
            {pendingRequests.length > 0 && <span className="pill-dot" />}
            {pendingRequests.length} PENDING
          </span>
        </div>

        {pendingRequests.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">Approval queue clear</div>
            <span>No pending elevation requests require peer review.</span>
          </div>
        ) : (
          <div className="queue-list">
            {pendingRequests.map((req) => {
              const isSelfRequest =
                req.requesterEmail.toLowerCase() === currentUser.email.toLowerCase();
              const approvals = req.approvals || [];
              const requiredCount =
                req.requiredApprovals && req.requiredApprovals >= 2
                  ? req.requiredApprovals
                  : 1;
              const alreadyApprovedByMe = approvals.some(
                (a) => a.approverEmail.toLowerCase() === currentUser.email.toLowerCase()
              );

              return (
                <div key={req.id} className="session-row">
                  <div className="session-top">
                    <div>
                      <div className="session-title-row">
                        <span className="session-group">{req.groupName}</span>
                        <span className="pill pill-neutral">{resolveSpaceLabel(req.spaceId)}</span>
                        {req.ticketId && (
                          <span className="tag-chip">{req.ticketId}</span>
                        )}
                        {requiredCount >= 2 && (
                          <span className="pill pill-pending tabular">
                            QUORUM {approvals.length}/{requiredCount}
                          </span>
                        )}
                      </div>
                      <div className="session-meta tabular">
                        <span>Requester: <code className="text-mono">{req.requesterEmail}</code></span>
                        <span>TTL: {req.durationMinutes}m</span>
                        {approvals.length > 0 && (
                          <span>
                            1st peer: <code className="text-mono">{approvals.map((a) => a.approverEmail).join(', ')}</code>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="session-actions">
                      {isSelfRequest ? (
                        <span className="pill pill-pending" title="Self-approval blocked">
                          SELF-REQUEST · AWAITING PEER
                        </span>
                      ) : alreadyApprovedByMe ? (
                        <span className="pill pill-active">
                          <Check size={11} />
                          RECORDED (1/{requiredCount})
                        </span>
                      ) : isAuthorizedToApprove ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-success btn-sm"
                            onClick={() => {
                              setReviewNote('');
                              setReviewModal({ request: req, action: 'approve' });
                            }}
                          >
                            <Check size={12} />
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setReviewNote('');
                              setReviewModal({ request: req, action: 'deny' });
                            }}
                          >
                            <X size={12} />
                            Deny
                          </button>
                        </>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                          Approver required
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="session-reason">{req.justification}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Modal
        open={Boolean(reviewModal)}
        onClose={() => setReviewModal(null)}
        title={
          reviewModal?.action === 'approve'
            ? 'Authorize directory elevation'
            : 'Deny directory elevation'
        }
        description={
          reviewModal
            ? `${reviewModal.request.requesterEmail} → ${reviewModal.request.groupEmail} (${reviewModal.request.durationMinutes}m)`
            : undefined
        }
        maxWidth="440px"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setReviewModal(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="peer-review-form"
              className={`btn ${
                reviewModal?.action === 'deny' ? 'btn-danger-solid' : 'btn-cobalt'
              }`}
              disabled={reviewSubmitting}
            >
              {reviewSubmitting
                ? 'Recording...'
                : reviewModal?.action === 'approve'
                  ? 'Confirm authorization'
                  : 'Confirm denial'}
            </button>
          </>
        }
      >
        {reviewModal && (
          <form id="peer-review-form" onSubmit={submitReviewDecision} className="stack-md">
            <div className="session-reason">
              <div className="eyebrow" style={{ marginBottom: '0.2rem' }}>
                Justification {reviewModal.request.ticketId ? `· ${reviewModal.request.ticketId}` : ''}
              </div>
              <div>{reviewModal.request.justification}</div>
            </div>

            <div className="field">
              <label htmlFor="review-note" className="field-label">
                Audit review note {reviewModal.action === 'deny' ? '(recommended)' : '(optional)'}
              </label>
              <textarea
                id="review-note"
                className="textarea"
                rows={2}
                maxLength={500}
                placeholder={
                  reviewModal.action === 'approve'
                    ? 'Verification context for the audit ledger...'
                    : 'Reason for rejecting this elevation...'
                }
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
              />
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke directory membership?"
        message={
          revokeTarget
            ? `Immediately strip ${revokeTarget.requesterEmail} from ${revokeTarget.groupEmail} ahead of scheduled expiration?`
            : ''
        }
        confirmLabel="Revoke immediately"
        tone="danger"
        onConfirm={() => revokeTarget && handleRevoke(revokeTarget.id)}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}
