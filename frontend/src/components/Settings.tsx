import { useState, useEffect } from 'react';
import {
  Sliders,
  ShieldCheck,
  Layers,
  ClipboardCheck,
  Save,
  Loader2,
  Plus,
  Trash2,
  Edit2,
  Send,
  Eye,
  EyeOff,
  AlertTriangle,
  ArrowLeft
} from 'lucide-react';
import { AppConfig, WorkspaceGroup, GroupJitPolicy, SpaceConfig } from '../types.ts';
import { getAuthHeaders } from '../api.ts';
import { ConfirmDialog } from './Modal.tsx';

interface SettingsProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onConfigUpdated: () => void;
  onClose?: () => void;
}

interface PolicyChecklistProps {
  groups: WorkspaceGroup[];
  policies: GroupJitPolicy[];
  setPolicies: (next: GroupJitPolicy[]) => void;
  eligibleAttributes: string[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  manualEmail: string;
  setManualEmail: (v: string) => void;
  onAddManual: () => void;
  emptyMessage: string;
}

function GroupPolicyChecklist({
  groups,
  policies,
  setPolicies,
  eligibleAttributes,
  searchQuery,
  setSearchQuery,
  manualEmail,
  setManualEmail,
  onAddManual,
  emptyMessage
}: PolicyChecklistProps) {
  const filtered = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="stack-md">
      <input
        type="text"
        className="input"
        placeholder="Filter groups by name or email..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <div className="policy-list">
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem' }}>
            <span>{emptyMessage}</span>
          </div>
        ) : (
          filtered.map((group) => {
            const policy = policies.find(
              (p) => p.groupEmail.toLowerCase() === group.email.toLowerCase()
            );
            const isChecked = Boolean(policy);

            return (
              <div
                key={group.email}
                className={`policy-card ${isChecked ? 'policy-card--checked' : ''}`}
              >
                <label className="policy-card-head">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setPolicies([
                          ...policies,
                          { groupEmail: group.email, requiredAttributes: [] }
                        ]);
                      } else {
                        setPolicies(
                          policies.filter(
                            (p) => p.groupEmail.toLowerCase() !== group.email.toLowerCase()
                          )
                        );
                      }
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{group.name}</div>
                    <div className="text-mono text-muted" style={{ fontSize: '0.71rem' }}>{group.email}</div>
                  </div>
                </label>

                {isChecked && policy && (
                  <div className="policy-card-meta">
                    <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>Required tags:</span>
                    {eligibleAttributes.length === 0 ? (
                      <span className="text-muted">None defined</span>
                    ) : (
                      eligibleAttributes.map((attr) => {
                        const reqChecked = (policy.requiredAttributes || []).includes(attr);
                        return (
                          <label
                            key={attr}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              cursor: 'pointer',
                              fontWeight: reqChecked ? 600 : 400,
                              color: reqChecked ? 'var(--text-primary)' : 'var(--text-muted)'
                            }}
                          >
                            <input
                              type="checkbox"
                              style={{ accentColor: 'var(--accent)' }}
                              checked={reqChecked}
                              onChange={(e) => {
                                const current = policy.requiredAttributes || [];
                                const updated = e.target.checked
                                  ? [...current, attr]
                                  : current.filter((a) => a !== attr);
                                setPolicies(
                                  policies.map((p) =>
                                    p.groupEmail.toLowerCase() === group.email.toLowerCase()
                                      ? { ...p, requiredAttributes: updated }
                                      : p
                                  )
                                );
                              }}
                            />
                            {attr}
                          </label>
                        );
                      })
                    )}

                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        cursor: 'pointer',
                        marginLeft: 'auto',
                        fontWeight: 500,
                        color: policy.autoApproval ? 'var(--emerald-ink)' : 'var(--text-muted)'
                      }}
                    >
                      <input
                        type="checkbox"
                        style={{ accentColor: 'var(--emerald-ink)' }}
                        checked={Boolean(policy.autoApproval)}
                        onChange={(e) =>
                          setPolicies(
                            policies.map((p) =>
                              p.groupEmail.toLowerCase() === group.email.toLowerCase()
                                ? { ...p, autoApproval: e.target.checked }
                                : p
                            )
                          )
                        }
                      />
                      Pre-approved
                    </label>
                  </div>
                )}

                {isChecked && policy && (
                  <div className="policy-card-controls">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span className="text-muted">Max TTL:</span>
                      <select
                        className="select-inline tabular"
                        value={policy.maxDurationMinutes || 240}
                        onChange={(e) =>
                          setPolicies(
                            policies.map((p) =>
                              p.groupEmail.toLowerCase() === group.email.toLowerCase()
                                ? { ...p, maxDurationMinutes: Number(e.target.value) }
                                : p
                            )
                          )
                        }
                      >
                        <option value={30}>30m</option>
                        <option value={60}>1h</option>
                        <option value={120}>2h</option>
                        <option value={240}>4h</option>
                      </select>
                    </label>

                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span className="text-muted">Quorum:</span>
                      <select
                        className="select-inline tabular"
                        disabled={Boolean(policy.autoApproval)}
                        value={policy.requiredApprovals || 1}
                        onChange={(e) =>
                          setPolicies(
                            policies.map((p) =>
                              p.groupEmail.toLowerCase() === group.email.toLowerCase()
                                ? { ...p, requiredApprovals: Number(e.target.value) }
                                : p
                            )
                          )
                        }
                      >
                        <option value={1}>1 peer</option>
                        <option value={2}>2 peers</option>
                      </select>
                    </label>

                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        cursor: 'pointer',
                        marginLeft: 'auto',
                        fontWeight: 500,
                        color: policy.allowBreakGlass ? 'var(--rose-ink)' : 'var(--text-muted)'
                      }}
                    >
                      <input
                        type="checkbox"
                        style={{ accentColor: 'var(--rose-ink)' }}
                        checked={Boolean(policy.allowBreakGlass)}
                        onChange={(e) =>
                          setPolicies(
                            policies.map((p) =>
                              p.groupEmail.toLowerCase() === group.email.toLowerCase()
                                ? { ...p, allowBreakGlass: e.target.checked }
                                : p
                            )
                          )
                        }
                      />
                      Allow break-glass (30m)
                    </label>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="field-row">
        <input
          type="email"
          className="input"
          placeholder="Add group email manually (e.g. ops-admins@company.com)..."
          value={manualEmail}
          onChange={(e) => setManualEmail(e.target.value)}
        />
        <button type="button" className="btn btn-secondary" onClick={onAddManual}>
          <Plus size={14} />
          Add group
        </button>
      </div>
    </div>
  );
}

export default function SettingsView({ showToast, onConfigUpdated }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'system' | 'policies' | 'spaces' | 'reviews'>('system');

  // Global config states
  const [mode, setMode] = useState<'MOCK' | 'LIVE'>('MOCK');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [autoApproval, setAutoApproval] = useState(false);
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [serviceAccountEmail, setServiceAccountEmail] = useState('');
  const [authMethod, setAuthMethod] = useState<'wif' | 'json'>('wif');
  const [groupPolicies, setGroupPolicies] = useState<GroupJitPolicy[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [eligibleAttributes, setEligibleAttributes] = useState<string[]>([]);
  const [newAttributeInput, setNewAttributeInput] = useState('');
  const [attestationIntervalDays, setAttestationIntervalDays] = useState(90);

  const [orphanedAlerts, setOrphanedAlerts] = useState<Record<string, string[]>>({});
  const [attestingGroup, setAttestingGroup] = useState<string | null>(null);
  const [remediatingKey, setRemediatingKey] = useState<string | null>(null);

  // Spaces states
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [editingSpace, setEditingSpace] = useState<SpaceConfig | null>(null);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);
  const [deleteSpaceTarget, setDeleteSpaceTarget] = useState<SpaceConfig | null>(null);

  const [spaceName, setSpaceName] = useState('');
  const [spaceDomain, setSpaceDomain] = useState('');
  const [spaceAdminEmail, setSpaceAdminEmail] = useState('');
  const [spaceServiceAccountJson, setSpaceServiceAccountJson] = useState('');
  const [spaceServiceAccountEmail, setSpaceServiceAccountEmail] = useState('');
  const [spaceAuthMethod, setSpaceAuthMethod] = useState<'wif' | 'json'>('wif');
  const [spaceAutoApproval, setSpaceAutoApproval] = useState(false);
  const [spaceGroupPolicies, setSpaceGroupPolicies] = useState<GroupJitPolicy[]>([]);
  const [spaceWebhookUrl, setSpaceWebhookUrl] = useState('');

  const [showAdminEmail, setShowAdminEmail] = useState(false);
  const [showSAEmail, setShowSAEmail] = useState(false);
  const [showSpaceAdminEmail, setShowSpaceAdminEmail] = useState(false);
  const [showSpaceSAEmail, setShowSpaceSAEmail] = useState(false);

  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [spaceGroupSearchQuery, setSpaceGroupSearchQuery] = useState('');
  const [manualGroupEmail, setManualGroupEmail] = useState('');
  const [manualSpaceGroupEmail, setManualSpaceGroupEmail] = useState('');

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config', { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) {
        setConfig(data);
        setMode(data.mode);
        setDomain(data.domain);
        setAdminEmail(data.adminEmail || '');
        setAutoApproval(data.autoApproval);
        setGroupPolicies(data.groupPolicies || []);
        setWebhookUrl(data.webhookUrl || '');
        setEligibleAttributes(data.eligibleAttributes || []);
        setServiceAccountEmail(data.serviceAccountEmail || '');
        setAuthMethod(data.hasServiceAccount ? 'json' : 'wif');
        setServiceAccountJson('');
        setAttestationIntervalDays(
          data.attestationIntervalDays !== undefined ? data.attestationIntervalDays : 90
        );
      } else {
        showToast(data.error || 'Failed to load configuration.', 'error');
      }
    } catch {
      showToast('Failed to load configuration.', 'error');
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchSpaces = async () => {
    try {
      const res = await fetch('/api/spaces', { headers: getAuthHeaders() });
      if (res.ok) {
        setSpaces(await res.json());
      }
    } catch (err) {
      console.error('Failed to load spaces', err);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/groups', { headers: getAuthHeaders() });
      const data = await res.json();
      if (res.ok) {
        setGroups(data);
      } else {
        showToast(data.error || 'Failed to load Workspace groups.', 'error');
      }
    } catch {
      showToast('Failed to load Workspace groups.', 'error');
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchSpaces();
    fetchGroups();
  }, []);

  const addManualGroup = (
    rawEmail: string,
    currentPolicies: GroupJitPolicy[],
    updatePolicies: (next: GroupJitPolicy[]) => void,
    clearInput: () => void
  ) => {
    const email = rawEmail.trim().toLowerCase();
    if (!email) return;
    if (!email.includes('@')) {
      showToast('Enter a valid group email address.', 'error');
      return;
    }
    if (currentPolicies.some((p) => p.groupEmail.toLowerCase() === email)) {
      showToast('A policy already exists for this group.', 'error');
      return;
    }
    if (!groups.some((g) => g.email.toLowerCase() === email)) {
      const generatedName =
        email
          .split('@')[0]
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()) + ' Group';
      setGroups([...groups, { email, name: generatedName, description: 'Manually added group' }]);
    }
    updatePolicies([
      ...currentPolicies,
      { groupEmail: email, requiredAttributes: [], autoApproval: false }
    ]);
    clearInput();
    showToast(`Added policy for ${email}.`, 'success');
  };

  const handleTestWebhook = async (url: string) => {
    if (!url.trim()) {
      showToast('Enter a webhook URL first.', 'error');
      return;
    }
    try {
      const res = await fetch('/api/config/test-webhook', {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ webhookUrl: url })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Test webhook delivered.', 'success');
      } else {
        showToast(data.error || 'Failed to dispatch test webhook.', 'error');
      }
    } catch {
      showToast('Failed to test webhook connection.', 'error');
    }
  };

  const handleAttestPolicy = async (groupEmail: string, spaceId?: string) => {
    setAttestingGroup(groupEmail);
    try {
      const url = spaceId
        ? `/api/spaces/${spaceId}/policies/attest`
        : `/api/config/policies/attest`;
      const res = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ groupEmail })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Certified ${groupEmail}.`, 'success');
        if (data.orphanedMembers && data.orphanedMembers.length > 0) {
          setOrphanedAlerts((prev) => ({
            ...prev,
            [groupEmail.toLowerCase()]: data.orphanedMembers
          }));
          showToast(`Orphaned members detected in ${groupEmail}.`, 'error');
        } else {
          setOrphanedAlerts((prev) => {
            const updated = { ...prev };
            delete updated[groupEmail.toLowerCase()];
            return updated;
          });
        }
        fetchConfig();
        fetchSpaces();
      } else {
        showToast(data.error || 'Failed to certify policy.', 'error');
      }
    } catch {
      showToast('Failed to certify policy.', 'error');
    } finally {
      setAttestingGroup(null);
    }
  };

  const handleRemediateOrphan = async (
    groupEmail: string,
    memberEmail: string,
    spaceId?: string
  ) => {
    const key = `${groupEmail.toLowerCase()}::${memberEmail.toLowerCase()}`;
    setRemediatingKey(key);
    try {
      const url = spaceId
        ? `/api/spaces/${spaceId}/policies/remediate-orphan`
        : `/api/config/policies/remediate-orphan`;
      const res = await fetch(url, {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify({ groupEmail, memberEmail })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Removed ${memberEmail} from ${groupEmail}.`, 'success');
        setOrphanedAlerts((prev) => {
          const remaining = (prev[groupEmail.toLowerCase()] || []).filter(
            (m) => m.toLowerCase() !== memberEmail.toLowerCase()
          );
          const next = { ...prev };
          if (remaining.length === 0) {
            delete next[groupEmail.toLowerCase()];
          } else {
            next[groupEmail.toLowerCase()] = remaining;
          }
          return next;
        });
      } else {
        showToast(data.error || 'Failed to remove orphaned member.', 'error');
      }
    } catch {
      showToast('Failed to remediate orphaned member.', 'error');
    } finally {
      setRemediatingKey(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload: Record<string, unknown> = {
        mode,
        domain,
        adminEmail,
        serviceAccountEmail: authMethod === 'wif' ? serviceAccountEmail : '',
        autoApproval,
        groupPolicies,
        webhookUrl,
        eligibleAttributes,
        attestationIntervalDays
      };

      if (authMethod === 'json') {
        if (serviceAccountJson.trim()) {
          try {
            JSON.parse(serviceAccountJson);
            payload.serviceAccountJson = serviceAccountJson;
          } catch {
            showToast('Invalid JSON credentials format.', 'error');
            setSaving(false);
            return;
          }
        }
      } else {
        payload.serviceAccountJson = '';
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: getAuthHeaders(true),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Settings saved.', 'success');
        onConfigUpdated();
        fetchConfig();
      } else {
        showToast(data.error || 'Failed to save settings.', 'error');
      }
    } catch {
      showToast('Server error saving settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSpace = () => {
    setEditingSpace(null);
    setIsCreatingSpace(true);
    setSpaceName('');
    setSpaceDomain('');
    setSpaceAdminEmail('');
    setSpaceServiceAccountJson('');
    setSpaceServiceAccountEmail('');
    setSpaceAuthMethod('wif');
    setSpaceAutoApproval(false);
    setSpaceGroupPolicies([]);
    setSpaceWebhookUrl('');
  };

  const handleEditSpace = (space: SpaceConfig) => {
    setEditingSpace(space);
    setIsCreatingSpace(false);
    setSpaceName(space.name);
    setSpaceDomain(space.domain);
    setSpaceAdminEmail(space.adminEmail || '');
    setSpaceServiceAccountJson('');
    setSpaceServiceAccountEmail(space.serviceAccountEmail || '');
    setSpaceAuthMethod(space.hasServiceAccount || space.serviceAccountJson ? 'json' : 'wif');
    setSpaceAutoApproval(space.autoApproval);
    setSpaceGroupPolicies(space.groupPolicies || []);
    setSpaceWebhookUrl(space.webhookUrl || '');
  };

  const handleSaveSpaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceName || !spaceDomain || !spaceAdminEmail) {
      showToast('Space name, domain, and operator email are required.', 'error');
      return;
    }

    if (spaceServiceAccountJson.trim()) {
      try {
        JSON.parse(spaceServiceAccountJson);
      } catch {
        showToast('Invalid Space Service Account JSON.', 'error');
        return;
      }
    }

    const payload: Partial<SpaceConfig> = {
      name: spaceName,
      domain: spaceDomain,
      adminEmail: spaceAdminEmail,
      serviceAccountEmail: spaceAuthMethod === 'wif' ? spaceServiceAccountEmail : '',
      autoApproval: spaceAutoApproval,
      groupPolicies: spaceGroupPolicies,
      webhookUrl: spaceWebhookUrl || undefined
    };

    if (spaceAuthMethod === 'json') {
      if (spaceServiceAccountJson.trim()) {
        payload.serviceAccountJson = spaceServiceAccountJson;
      }
    } else {
      payload.serviceAccountJson = '';
    }

    try {
      const url = isCreatingSpace ? '/api/spaces' : `/api/spaces/${editingSpace?.id}`;
      const method = isCreatingSpace ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(true),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(isCreatingSpace ? 'Space created.' : 'Space updated.', 'success');
        setEditingSpace(null);
        setIsCreatingSpace(false);
        fetchSpaces();
        fetchGroups();
        onConfigUpdated();
      } else {
        showToast(data.error || 'Failed to save space.', 'error');
      }
    } catch {
      showToast('Server error saving space.', 'error');
    }
  };

  const confirmDeleteSpace = async () => {
    if (!deleteSpaceTarget) return;
    try {
      const res = await fetch(`/api/spaces/${deleteSpaceTarget.id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Space deleted.', 'success');
        fetchSpaces();
        fetchGroups();
        onConfigUpdated();
      } else {
        showToast(data.error || 'Failed to delete space.', 'error');
      }
    } catch {
      showToast('Server error deleting space.', 'error');
    } finally {
      setDeleteSpaceTarget(null);
    }
  };

  if (loadingConfig) {
    return (
      <div className="surface-card">
        <div className="empty-state">
          <Loader2 size={18} className="spin" />
          <span>Loading settings...</span>
        </div>
      </div>
    );
  }

  const globalGroups = groups.filter((g) => {
    const grpDomain = g.email.split('@')[1]?.toLowerCase();
    const spaceDomains = spaces.map((s) => s.domain.toLowerCase());
    return !spaceDomains.includes(grpDomain);
  });

  const renderAttestationTable = (policies: GroupJitPolicy[], spaceId?: string) => {
    if (!policies || policies.length === 0) {
      return (
        <div className="empty-state" style={{ padding: '1.5rem' }}>
          <span>No policies configured.</span>
        </div>
      );
    }

    return (
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Group</th>
              <th>Mode</th>
              <th>Last certified</th>
              <th>Next due</th>
              <th style={{ textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {policies.map((policy) => {
              const isOverdue = Boolean(
                policy.attestationDueAt && new Date(policy.attestationDueAt) < new Date()
              );
              const orphaned = orphanedAlerts[policy.groupEmail.toLowerCase()];

              return (
                <tr key={policy.groupEmail}>
                  <td>
                    <div className="text-mono" style={{ fontWeight: 600, fontSize: '0.76rem' }}>{policy.groupEmail}</div>
                    {orphaned && orphaned.length > 0 && (
                      <div className="orphan-list">
                        {orphaned.map((memberEmail) => {
                          const key = `${policy.groupEmail.toLowerCase()}::${memberEmail.toLowerCase()}`;
                          return (
                            <div key={memberEmail} className="orphan-item">
                              <span>Orphaned member: <strong>{memberEmail}</strong></span>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                style={{ height: '22px', padding: '0 0.45rem', fontSize: '0.68rem' }}
                                disabled={remediatingKey === key}
                                onClick={() =>
                                  handleRemediateOrphan(policy.groupEmail, memberEmail, spaceId)
                                }
                              >
                                {remediatingKey === key ? 'Removing...' : 'Remove'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <span className={`pill ${policy.autoApproval ? 'pill-active' : 'pill-neutral'}`}>
                        {policy.autoApproval
                          ? 'Pre-approved'
                          : (policy.requiredApprovals || 1) >= 2
                            ? '2-peer quorum'
                            : '1-peer review'}
                      </span>
                      {policy.allowBreakGlass && (
                        <span className="pill pill-denied">Break-glass</span>
                      )}
                    </div>
                  </td>
                  <td className="tabular">
                    <div style={{ fontSize: '0.8rem' }}>
                      {policy.lastCertifiedAt
                        ? new Date(policy.lastCertifiedAt).toLocaleDateString()
                        : 'Never'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {policy.lastCertifiedBy || '—'}
                    </div>
                  </td>
                  <td className="tabular">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <span className={`pill ${isOverdue ? 'pill-denied' : 'pill-active'}`}>
                        {isOverdue ? 'Overdue' : 'Compliant'}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {policy.attestationDueAt
                          ? new Date(policy.attestationDueAt).toLocaleDateString()
                          : '—'}
                      </span>
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleAttestPolicy(policy.groupEmail, spaceId)}
                      disabled={attestingGroup === policy.groupEmail}
                    >
                      {attestingGroup === policy.groupEmail ? (
                        <Loader2 size={12} className="spin" />
                      ) : (
                        <ClipboardCheck size={13} />
                      )}
                      Certify
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        <button
          type="button"
          className={`settings-nav-btn ${activeTab === 'system' ? 'active' : ''}`}
          onClick={() => setActiveTab('system')}
        >
          <Sliders size={15} />
          General
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeTab === 'policies' ? 'active' : ''}`}
          onClick={() => setActiveTab('policies')}
        >
          <ShieldCheck size={15} />
          Group policies
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeTab === 'spaces' ? 'active' : ''}`}
          onClick={() => setActiveTab('spaces')}
        >
          <Layers size={15} />
          Tenant spaces
        </button>
        <button
          type="button"
          className={`settings-nav-btn ${activeTab === 'reviews' ? 'active' : ''}`}
          onClick={() => setActiveTab('reviews')}
        >
          <ClipboardCheck size={15} />
          Access reviews
        </button>
      </nav>

      <div className="stack-lg">
        {/* TAB 1: GENERAL SYSTEM SETTINGS */}
        {activeTab === 'system' && (
          <form onSubmit={handleSaveConfig} className="surface-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">General configuration</h3>
                <p className="card-subtitle">Directory engine, ABAC attributes, webhooks, and attestation cadence</p>
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                Save changes
              </button>
            </div>

            <div className="card-body">
              <div className="card-section stack-md">
                <div className="toggle-row">
                  <div>
                    <div className="toggle-row-title">Directory integration mode</div>
                    <div className="toggle-row-desc">
                      {mode === 'LIVE'
                        ? 'Connected to Google Workspace Admin SDK Directory API'
                        : 'Simulated local sandbox with seeded groups'}
                    </div>
                  </div>
                  <div className="segmented" role="group" aria-label="Integration mode">
                    <button
                      type="button"
                      className={`segmented-btn ${mode === 'MOCK' ? 'active' : ''}`}
                      onClick={() => setMode('MOCK')}
                    >
                      MOCK
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${mode === 'LIVE' ? 'active' : ''}`}
                      onClick={() => setMode('LIVE')}
                    >
                      LIVE
                    </button>
                  </div>
                </div>

                <div className="toggle-row">
                  <div>
                    <div className="toggle-row-title">Global auto-approval</div>
                    <div className="toggle-row-desc">
                      Provision global group requests immediately without peer review
                    </div>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={autoApproval}
                      onChange={(e) => setAutoApproval(e.target.checked)}
                    />
                    <span className="switch-track" />
                  </label>
                </div>

                <div className="field">
                  <label htmlFor="domain" className="field-label">Primary Workspace domain</label>
                  <input
                    id="domain"
                    type="text"
                    className="input"
                    placeholder="company.com"
                    value={domain}
                    onChange={(e) => setDomain(e.target.value)}
                    required
                  />
                </div>
              </div>

              {mode === 'LIVE' && (
                <div className="card-section stack-md">
                  <div>
                    <h4 className="section-heading">Google Workspace Directory credentials</h4>
                    <p className="section-desc">
                      Keyless Workload Identity Federation via IAM Credentials API is recommended for Cloud Run.
                    </p>
                  </div>

                  <div className="segmented" role="group" aria-label="Authentication method">
                    <button
                      type="button"
                      className={`segmented-btn ${authMethod === 'wif' ? 'active' : ''}`}
                      onClick={() => setAuthMethod('wif')}
                    >
                      Workload Identity (keyless)
                    </button>
                    <button
                      type="button"
                      className={`segmented-btn ${authMethod === 'json' ? 'active' : ''}`}
                      onClick={() => setAuthMethod('json')}
                    >
                      JSON config / key
                    </button>
                  </div>

                  <div className="field">
                    <label htmlFor="adminEmail" className="field-label">Delegated operator email</label>
                    <div className="input-wrap">
                      <input
                        id="adminEmail"
                        type={showAdminEmail ? 'email' : 'password'}
                        className="input input--with-trail"
                        placeholder="jit-operator@company.com"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="input-trail-btn"
                        onClick={() => setShowAdminEmail(!showAdminEmail)}
                        aria-label={showAdminEmail ? 'Hide operator email' : 'Show operator email'}
                      >
                        {showAdminEmail ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                    <p className="field-hint">
                      Assign a custom Workspace Admin Role scoped strictly to Group Read/Update privileges.
                    </p>
                  </div>

                  {authMethod === 'wif' ? (
                    <div className="field">
                      <label htmlFor="saEmail" className="field-label">Delegation service account email</label>
                      <div className="input-wrap">
                        <input
                          id="saEmail"
                          type={showSAEmail ? 'email' : 'password'}
                          className="input input--with-trail"
                          placeholder="workspace-dwd@project.iam.gserviceaccount.com"
                          value={serviceAccountEmail}
                          onChange={(e) => setServiceAccountEmail(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          className="input-trail-btn"
                          onClick={() => setShowSAEmail(!showSAEmail)}
                          aria-label={showSAEmail ? 'Hide service account email' : 'Show service account email'}
                        >
                          {showSAEmail ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor="credentials" className="field-label">Service Account or External WIF JSON</label>
                      <textarea
                        id="credentials"
                        className="textarea text-mono"
                        rows={4}
                        placeholder='{ "type": "external_account", ... }'
                        value={serviceAccountJson}
                        onChange={(e) => setServiceAccountJson(e.target.value)}
                      />
                      {config?.hasServiceAccount && (
                        <p className="field-hint" style={{ color: 'var(--emerald-ink)' }}>
                          Credentials configured on server. Leave blank to keep existing credentials.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="callout callout--warn">
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <span>
                      Authorize Domain-Wide Delegation with scope <code>https://www.googleapis.com/auth/admin.directory.group</code>.
                    </span>
                  </div>
                </div>
              )}

              <div className="card-section">
                <h4 className="section-heading">ABAC attribute tags</h4>
                <p className="section-desc">
                  Tags assigned to users to gate eligibility for sensitive Workspace groups.
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                  {eligibleAttributes.length === 0 ? (
                    <span className="field-hint">No attribute tags configured.</span>
                  ) : (
                    eligibleAttributes.map((attr) => (
                      <span key={attr} className="tag-chip">
                        {attr}
                        <button
                          type="button"
                          className="tag-chip-remove"
                          onClick={() =>
                            setEligibleAttributes(eligibleAttributes.filter((a) => a !== attr))
                          }
                          aria-label={`Remove attribute ${attr}`}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </div>

                <div className="field-row">
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. security-tier-0"
                    value={newAttributeInput}
                    onChange={(e) =>
                      setNewAttributeInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                    }
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      const val = newAttributeInput.trim().toLowerCase();
                      if (val && !eligibleAttributes.includes(val)) {
                        setEligibleAttributes([...eligibleAttributes, val]);
                        setNewAttributeInput('');
                      }
                    }}
                  >
                    <Plus size={14} />
                    Add tag
                  </button>
                </div>
              </div>

              <div className="card-section stack-md">
                <div>
                  <h4 className="section-heading">Notifications & recertification</h4>
                  <p className="section-desc">
                    HTTPS chat webhook alerts and periodic policy attestation schedule.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="webhookUrl" className="field-label">Global webhook URL</label>
                  <div className="field-row">
                    <input
                      id="webhookUrl"
                      type="url"
                      className="input"
                      placeholder="https://hooks.slack.com/services/..."
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleTestWebhook(webhookUrl)}
                    >
                      <Send size={13} />
                      Test
                    </button>
                  </div>
                </div>

                <div className="field" style={{ maxWidth: '240px' }}>
                  <label htmlFor="attestationDays" className="field-label">Attestation interval (days)</label>
                  <input
                    id="attestationDays"
                    type="number"
                    min={1}
                    className="input tabular"
                    value={attestationIntervalDays}
                    onChange={(e) => setAttestationIntervalDays(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </form>
        )}

        {/* TAB 2: GLOBAL GROUP POLICIES */}
        {activeTab === 'policies' && (
          <form onSubmit={handleSaveConfig} className="surface-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Global group policies</h3>
                <p className="card-subtitle">Select requestable Workspace groups and required ABAC tags</p>
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                Save policies
              </button>
            </div>

            <div className="card-body">
              <GroupPolicyChecklist
                groups={globalGroups}
                policies={groupPolicies}
                setPolicies={setGroupPolicies}
                eligibleAttributes={eligibleAttributes}
                searchQuery={groupSearchQuery}
                setSearchQuery={setGroupSearchQuery}
                manualEmail={manualGroupEmail}
                setManualEmail={setManualGroupEmail}
                onAddManual={() =>
                  addManualGroup(manualGroupEmail, groupPolicies, setGroupPolicies, () =>
                    setManualGroupEmail('')
                  )
                }
                emptyMessage="No matching global groups found."
              />
            </div>
          </form>
        )}

        {/* TAB 3: MULTI-TENANT SPACES */}
        {activeTab === 'spaces' && (
          <section className="surface-card">
            {!editingSpace && !isCreatingSpace ? (
              <>
                <div className="card-header">
                  <div>
                    <h3 className="card-title">Tenant spaces</h3>
                    <p className="card-subtitle">Isolate secondary Workspace domains, credentials, and webhooks</p>
                  </div>
                  <button type="button" className="btn btn-primary" onClick={handleAddSpace}>
                    <Plus size={14} />
                    New space
                  </button>
                </div>

                {spaces.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon">
                      <Layers size={18} />
                    </div>
                    <span>No tenant spaces configured.</span>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Space</th>
                          <th>Domain</th>
                          <th>Operator</th>
                          <th>Approval</th>
                          <th>Webhook</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {spaces.map((space) => (
                          <tr key={space.id}>
                            <td style={{ fontWeight: 600 }}>{space.name}</td>
                            <td className="text-mono">@{space.domain}</td>
                            <td className="text-muted">{space.adminEmail}</td>
                            <td>
                              <span className={`pill ${space.autoApproval ? 'pill-active' : 'pill-neutral'}`}>
                                {space.autoApproval ? 'Auto' : 'Peer'}
                              </span>
                            </td>
                            <td>
                              <span className={`pill ${space.webhookUrl ? 'pill-active' : 'pill-neutral'}`}>
                                {space.webhookUrl ? 'Enabled' : 'Fallback'}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => handleEditSpace(space)}
                                  title="Edit space"
                                  aria-label={`Edit ${space.name}`}
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => setDeleteSpaceTarget(space)}
                                  title="Delete space"
                                  aria-label={`Delete ${space.name}`}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <form onSubmit={handleSaveSpaceSubmit}>
                <div className="card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <button
                      type="button"
                      className="icon-btn icon-btn--bordered"
                      onClick={() => {
                        setEditingSpace(null);
                        setIsCreatingSpace(false);
                      }}
                      aria-label="Back to spaces"
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <div>
                      <h3 className="card-title">
                        {isCreatingSpace ? 'Create tenant space' : `Edit ${spaceName}`}
                      </h3>
                      <p className="card-subtitle">Domain-scoped delegation and group eligibility</p>
                    </div>
                  </div>
                  <div className="page-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setEditingSpace(null);
                        setIsCreatingSpace(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary">
                      <Save size={14} />
                      Save space
                    </button>
                  </div>
                </div>

                <div className="card-body">
                  <div className="card-section stack-md">
                    <div className="field">
                      <label htmlFor="spaceName" className="field-label">Space name</label>
                      <input
                        id="spaceName"
                        type="text"
                        className="input"
                        placeholder="Subsidiary EU"
                        value={spaceName}
                        onChange={(e) => setSpaceName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="spaceDomain" className="field-label">Workspace domain</label>
                      <input
                        id="spaceDomain"
                        type="text"
                        className="input"
                        placeholder="subsidiary.eu"
                        value={spaceDomain}
                        onChange={(e) => setSpaceDomain(e.target.value)}
                        required
                      />
                    </div>

                    <div className="toggle-row">
                      <div>
                        <div className="toggle-row-title">Space auto-approval</div>
                        <div className="toggle-row-desc">
                          Automatically approve requests for groups in this space
                        </div>
                      </div>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={spaceAutoApproval}
                          onChange={(e) => setSpaceAutoApproval(e.target.checked)}
                        />
                        <span className="switch-track" />
                      </label>
                    </div>

                    <div className="field">
                      <label htmlFor="spaceAdminEmail" className="field-label">Delegated operator email</label>
                      <div className="input-wrap">
                        <input
                          id="spaceAdminEmail"
                          type={showSpaceAdminEmail ? 'email' : 'password'}
                          className="input input--with-trail"
                          placeholder="operator@subsidiary.eu"
                          value={spaceAdminEmail}
                          onChange={(e) => setSpaceAdminEmail(e.target.value)}
                          required
                        />
                        <button
                          type="button"
                          className="input-trail-btn"
                          onClick={() => setShowSpaceAdminEmail(!showSpaceAdminEmail)}
                          aria-label={showSpaceAdminEmail ? 'Hide email' : 'Show email'}
                        >
                          {showSpaceAdminEmail ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </div>

                    <div className="segmented" role="group" aria-label="Space authentication method">
                      <button
                        type="button"
                        className={`segmented-btn ${spaceAuthMethod === 'wif' ? 'active' : ''}`}
                        onClick={() => setSpaceAuthMethod('wif')}
                      >
                        Workload Identity (keyless)
                      </button>
                      <button
                        type="button"
                        className={`segmented-btn ${spaceAuthMethod === 'json' ? 'active' : ''}`}
                        onClick={() => setSpaceAuthMethod('json')}
                      >
                        JSON override
                      </button>
                    </div>

                    {spaceAuthMethod === 'wif' ? (
                      <div className="field">
                        <label htmlFor="spaceSaEmail" className="field-label">
                          Service account email (optional override)
                        </label>
                        <div className="input-wrap">
                          <input
                            id="spaceSaEmail"
                            type={showSpaceSAEmail ? 'email' : 'password'}
                            className="input input--with-trail"
                            placeholder="Leave blank to inherit global service account"
                            value={spaceServiceAccountEmail}
                            onChange={(e) => setSpaceServiceAccountEmail(e.target.value)}
                          />
                          <button
                            type="button"
                            className="input-trail-btn"
                            onClick={() => setShowSpaceSAEmail(!showSpaceSAEmail)}
                            aria-label={showSpaceSAEmail ? 'Hide email' : 'Show email'}
                          >
                            {showSpaceSAEmail ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="field">
                        <label htmlFor="spaceCreds" className="field-label">
                          Service Account / WIF JSON (optional override)
                        </label>
                        <textarea
                          id="spaceCreds"
                          className="textarea text-mono"
                          rows={3}
                          placeholder='{ "type": "external_account", ... }'
                          value={spaceServiceAccountJson}
                          onChange={(e) => setSpaceServiceAccountJson(e.target.value)}
                        />
                      </div>
                    )}

                    <div className="field">
                      <label htmlFor="spaceWebhook" className="field-label">Space webhook URL (optional)</label>
                      <div className="field-row">
                        <input
                          id="spaceWebhook"
                          type="url"
                          className="input"
                          placeholder="https://hooks.slack.com/services/..."
                          value={spaceWebhookUrl}
                          onChange={(e) => setSpaceWebhookUrl(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => handleTestWebhook(spaceWebhookUrl)}
                        >
                          <Send size={13} />
                          Test
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="card-section">
                    <h4 className="section-heading">Space group policies</h4>
                    <p className="section-desc">Configure eligible groups for this tenant space.</p>
                    <GroupPolicyChecklist
                      groups={groups}
                      policies={spaceGroupPolicies}
                      setPolicies={setSpaceGroupPolicies}
                      eligibleAttributes={eligibleAttributes}
                      searchQuery={spaceGroupSearchQuery}
                      setSearchQuery={setSpaceGroupSearchQuery}
                      manualEmail={manualSpaceGroupEmail}
                      setManualEmail={setManualSpaceGroupEmail}
                      onAddManual={() =>
                        addManualGroup(
                          manualSpaceGroupEmail,
                          spaceGroupPolicies,
                          setSpaceGroupPolicies,
                          () => setManualSpaceGroupEmail('')
                        )
                      }
                      emptyMessage="No matching groups found."
                    />
                  </div>
                </div>
              </form>
            )}
          </section>
        )}

        {/* TAB 4: ACCESS REVIEWS & ATTESTATION */}
        {activeTab === 'reviews' && (
          <div className="stack-lg">
            <section className="surface-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Global policy attestation</h3>
                  <p className="card-subtitle">
                    Certifying a group scans Google Workspace for direct standing members bypassing JIT
                  </p>
                </div>
              </div>
              {renderAttestationTable(groupPolicies)}
            </section>

            {spaces.map((space) => (
              <section key={space.id} className="surface-card">
                <div className="card-header">
                  <div>
                    <h3 className="card-title">{space.name}</h3>
                    <p className="card-subtitle">@{space.domain}</p>
                  </div>
                </div>
                {renderAttestationTable(space.groupPolicies || [], space.id)}
              </section>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteSpaceTarget)}
        title="Delete tenant space?"
        message={
          deleteSpaceTarget
            ? `Delete space "${deleteSpaceTarget.name}" (@${deleteSpaceTarget.domain})? Requests for this domain will fall back to Global settings.`
            : ''
        }
        confirmLabel="Delete space"
        tone="danger"
        onConfirm={confirmDeleteSpace}
        onCancel={() => setDeleteSpaceTarget(null)}
      />
    </div>
  );
}
