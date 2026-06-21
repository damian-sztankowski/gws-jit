import { useState, useEffect } from 'react';
import { Settings, Database, Save, ShieldAlert, Loader2, X, Plus, Trash2, Edit, Bell, Globe, ClipboardCheck, Send } from 'lucide-react';
import { AppConfig, WorkspaceGroup, GroupJitPolicy, SpaceConfig } from '../types.ts';

interface SettingsProps {
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  onConfigUpdated: () => void;
  onClose: () => void;
}

export default function SettingsView({ showToast, onConfigUpdated, onClose }: SettingsProps) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'system' | 'policies' | 'spaces' | 'reviews'>('system');

  // Global Config Form states
  const [mode, setMode] = useState<'MOCK' | 'LIVE'>('MOCK');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [autoApproval, setAutoApproval] = useState(false);
  const [serviceAccountJson, setServiceAccountJson] = useState('');
  const [groupPolicies, setGroupPolicies] = useState<GroupJitPolicy[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [attestationIntervalDays, setAttestationIntervalDays] = useState(90);
  const [orphanedAlerts, setOrphanedAlerts] = useState<{[key: string]: string[]}>({});
  const [attestingGroup, setAttestingGroup] = useState<string | null>(null);

  // Space management states
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  const [editingSpace, setEditingSpace] = useState<SpaceConfig | null>(null);
  const [isCreatingSpace, setIsCreatingSpace] = useState(false);

  // Space Form states
  const [spaceName, setSpaceName] = useState('');
  const [spaceDomain, setSpaceDomain] = useState('');
  const [spaceAdminEmail, setSpaceAdminEmail] = useState('');
  const [spaceServiceAccountJson, setSpaceServiceAccountJson] = useState('');
  const [spaceAutoApproval, setSpaceAutoApproval] = useState(false);
  const [spaceGroupPolicies, setSpaceGroupPolicies] = useState<GroupJitPolicy[]>([]);
  const [spaceWebhookUrl, setSpaceWebhookUrl] = useState('');
  const [eligibleAttributes, setEligibleAttributes] = useState<string[]>([]);
  const [newAttributeInput, setNewAttributeInput] = useState('');
  const [serviceAccountEmail, setServiceAccountEmail] = useState('');
  const [spaceServiceAccountEmail, setSpaceServiceAccountEmail] = useState('');
  const [authMethod, setAuthMethod] = useState<'wif' | 'json'>('wif');
  const [spaceAuthMethod, setSpaceAuthMethod] = useState<'wif' | 'json'>('wif');

  // Search filter states
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [spaceGroupSearchQuery, setSpaceGroupSearchQuery] = useState('');
  const [manualGroupEmail, setManualGroupEmail] = useState('');
  const [manualSpaceGroupEmail, setManualSpaceGroupEmail] = useState('');

  const handleManualAddGlobalGroup = () => {
    const email = manualGroupEmail.trim().toLowerCase();
    if (!email) return;
    if (!email.includes('@')) {
      showToast("Please enter a valid email address.", "error");
      return;
    }
    const exists = groupPolicies.some(p => p.groupEmail.toLowerCase() === email);
    if (exists) {
      showToast("This group already has a policy configured.", "error");
      return;
    }
    const inGroups = groups.some(g => g.email.toLowerCase() === email);
    if (!inGroups) {
      const name = email.split('@')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + " Group";
      setGroups([...groups, {
        email,
        name,
        description: "Manually added Google Group"
      }]);
    }
    setGroupPolicies([...groupPolicies, {
      groupEmail: email,
      requiredAttributes: [],
      autoApproval: false
    }]);
    setManualGroupEmail('');
    showToast(`Added manual group policy for ${email}.`, "success");
  };

  const handleManualAddSpaceGroup = () => {
    const email = manualSpaceGroupEmail.trim().toLowerCase();
    if (!email) return;
    if (!email.includes('@')) {
      showToast("Please enter a valid email address.", "error");
      return;
    }
    const exists = spaceGroupPolicies.some(p => p.groupEmail.toLowerCase() === email);
    if (exists) {
      showToast("This group already has a policy configured in this Space.", "error");
      return;
    }
    const inGroups = groups.some(g => g.email.toLowerCase() === email);
    if (!inGroups) {
      const name = email.split('@')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + " Group";
      setGroups([...groups, {
        email,
        name,
        description: "Manually added Space Group"
      }]);
    }
    setSpaceGroupPolicies([...spaceGroupPolicies, {
      groupEmail: email,
      requiredAttributes: [],
      autoApproval: false
    }]);
    setManualSpaceGroupEmail('');
    showToast(`Added manual space group policy for ${email}.`, "success");
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
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
        setAttestationIntervalDays(data.attestationIntervalDays !== undefined ? data.attestationIntervalDays : 90);
      } else {
        showToast(data.error || "Failed to load configuration.", "error");
      }
    } catch (err) {
      showToast("Failed to load configuration.", "error");
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchSpaces = async () => {
    try {
      const res = await fetch('/api/spaces', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        setSpaces(data);
      }
    } catch (err) {
      console.error("Failed to load spaces", err);
    }
  };

  const fetchGroups = async () => {
    try {
      const res = await fetch('/api/groups', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        setGroups(data);
      } else {
        showToast(data.error || "Failed to load Workspace Groups.", "error");
      }
    } catch (err) {
      showToast("Failed to load Workspace Groups.", "error");
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchSpaces();
    fetchGroups();
  }, []);

  const handleTestWebhook = async (url: string) => {
    if (!url.trim()) {
      showToast("Please enter a webhook URL first.", "error");
      return;
    }
    try {
      const res = await fetch('/api/config/test-webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        },
        body: JSON.stringify({ webhookUrl: url })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Test webhook dispatched successfully. Check your channel!", "success");
      } else {
        showToast(data.error || "Failed to send test webhook.", "error");
      }
    } catch (err) {
      showToast("Failed to test webhook connection.", "error");
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        },
        body: JSON.stringify({ groupEmail })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`Policy for ${groupEmail} certified successfully!`, "success");
        if (data.orphanedMembers && data.orphanedMembers.length > 0) {
          setOrphanedAlerts(prev => ({
            ...prev,
            [groupEmail.toLowerCase()]: data.orphanedMembers
          }));
          showToast(`Warning: Orphaned members detected in ${groupEmail}!`, "error");
        } else {
          // Clear orphaned alert if it was resolved
          setOrphanedAlerts(prev => {
            const updated = { ...prev };
            delete updated[groupEmail.toLowerCase()];
            return updated;
          });
        }
        fetchConfig();
        fetchSpaces();
      } else {
        showToast(data.error || "Failed to certify policy.", "error");
      }
    } catch (err) {
      showToast("Failed to certify policy.", "error");
    } finally {
      setAttestingGroup(null);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const payload: any = {
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
          } catch (err) {
            showToast("Invalid JSON credentials format.", "error");
            setSaving(false);
            return;
          }
        }
      } else {
        payload.serviceAccountJson = '';
      }

      const res = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("System configuration updated successfully.", "success");
        onConfigUpdated();
        onClose();
      } else {
        showToast(data.error || "Failed to update configuration.", "error");
      }
    } catch (err) {
      showToast("Server error updating config.", "error");
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
    setSpaceAuthMethod(space.serviceAccountJson ? 'json' : 'wif');
    setSpaceAutoApproval(space.autoApproval);
    setSpaceGroupPolicies(space.groupPolicies || []);
    setSpaceWebhookUrl(space.webhookUrl || '');
  };

  const handleSaveSpaceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!spaceName || !spaceDomain || !spaceAdminEmail) {
      showToast("Space Name, Domain, and Admin Email are required.", "error");
      return;
    }

    if (spaceServiceAccountJson.trim()) {
      try {
        JSON.parse(spaceServiceAccountJson);
      } catch (err) {
        showToast("Invalid Space Service Account JSON format.", "error");
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
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast(isCreatingSpace ? "Space created successfully." : "Space updated successfully.", "success");
        setEditingSpace(null);
        setIsCreatingSpace(false);
        fetchSpaces();
        fetchGroups(); // Reload groups to capture space-specific mock groups if mode is MOCK
      } else {
        showToast(data.error || "Failed to save space configuration.", "error");
      }
    } catch (err) {
      showToast("Server error saving space config.", "error");
    }
  };

  const handleDeleteSpace = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Space configuration? Routing for this domain will fall back to Global settings.")) {
      return;
    }

    try {
      const res = await fetch(`/api/spaces/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('jit_token')}`
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast("Space deleted successfully.", "success");
        fetchSpaces();
        fetchGroups(); // Reload groups to remove mock space groups if in MOCK mode
      } else {
        showToast(data.error || "Failed to delete space.", "error");
      }
    } catch (err) {
      showToast("Server error deleting space.", "error");
    }
  };

  if (loadingConfig) {
    return null;
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(5, 7, 12, 0.85)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      padding: '2rem'
    }}>
      <div className="panel-card" style={{ width: '100%', maxWidth: '750px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        
        {/* Header */}
        <div className="panel-header" style={{ flexShrink: 0 }}>
          <h3>
            <Settings className="logo-icon" size={16} />
            Portal Settings
          </h3>
          <button 
            className="clean-btn clean-btn-secondary" 
            style={{ padding: '0.3rem', borderRadius: '50%' }}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="tabs-navigation" style={{ padding: '0.75rem 1.5rem 0', flexShrink: 0 }}>
          <button
            type="button"
            className={`tab-nav-item ${activeTab === 'system' ? 'active' : ''}`}
            onClick={() => setActiveTab('system')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Globe size={14} /> System Config
          </button>
          <button
            type="button"
            className={`tab-nav-item ${activeTab === 'policies' ? 'active' : ''}`}
            onClick={() => setActiveTab('policies')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <ShieldAlert size={14} /> Global Policies
          </button>
          <button
            type="button"
            className={`tab-nav-item ${activeTab === 'spaces' ? 'active' : ''}`}
            onClick={() => setActiveTab('spaces')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Database size={14} /> Spaces (Multi-Tenant)
          </button>
          <button
            type="button"
            className={`tab-nav-item ${activeTab === 'reviews' ? 'active' : ''}`}
            onClick={() => setActiveTab('reviews')}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <ClipboardCheck size={14} /> Access Reviews
          </button>
        </div>

        {/* Body content (scrollable container) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          
          {/* TAB 1: SYSTEM CONFIG */}
          {activeTab === 'system' && (
            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="settings-toggle-card">
                <div>
                  <h4 style={{ fontWeight: 600, fontSize: '0.95rem' }}>Workspace Integration Mode</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    {mode === 'LIVE' 
                      ? "Active Google Workspace Directory API integration" 
                      : "Simulated local sandbox using seed groups"}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', background: 'rgba(0,0,0,0.05)', padding: '0.2rem', borderRadius: '8px' }}>
                  <button
                    type="button"
                    className="clean-btn btn-sm"
                    style={{
                      padding: '0.35rem 0.7rem',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: mode === 'MOCK' ? 'var(--primary)' : 'transparent',
                      color: mode === 'MOCK' ? '#fff' : 'var(--text-dim)',
                      borderRadius: '6px',
                    }}
                    onClick={() => setMode('MOCK')}
                  >
                    MOCK
                  </button>
                  <button
                    type="button"
                    className="clean-btn btn-sm"
                    style={{
                      padding: '0.35rem 0.7rem',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: mode === 'LIVE' ? 'var(--primary)' : 'transparent',
                      color: mode === 'LIVE' ? '#fff' : 'var(--text-dim)',
                      borderRadius: '6px',
                    }}
                    onClick={() => setMode('LIVE')}
                  >
                    LIVE
                  </button>
                </div>
              </div>

              <div className="settings-toggle-card">
                <div>
                  <h4 style={{ fontWeight: 600, fontSize: '0.95rem' }}>Global Auto-Approval Policy</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    Instantly approve and provision all global JIT group memberships upon request
                  </p>
                </div>
                <label className="toggle-switch">
                  <input 
                    type="checkbox" 
                    checked={autoApproval}
                    onChange={(e) => setAutoApproval(e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div className="form-input-group">
                <label htmlFor="domain">Global Workspace Domain</label>
                <input
                  id="domain"
                  type="text"
                  className="clean-control"
                  placeholder="e.g. company.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required
                />
              </div>

              {mode === 'LIVE' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.25rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--secondary)' }}>
                    <Database size={16} />
                    <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Global Google Directory Credentials</h4>
                  </div>

                  <div className="form-input-group">
                    <label>Authentication Method</label>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>
                      <button
                        type="button"
                        className="clean-btn btn-sm"
                        style={{
                          padding: '0.35rem 0.7rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: authMethod === 'wif' ? 'var(--primary)' : 'transparent',
                          color: authMethod === 'wif' ? '#fff' : 'var(--text-dim)',
                          borderRadius: '6px',
                        }}
                        onClick={() => setAuthMethod('wif')}
                      >
                        Workload Identity Federation (Keyless)
                      </button>
                      <button
                        type="button"
                        className="clean-btn btn-sm"
                        style={{
                          padding: '0.35rem 0.7rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: authMethod === 'json' ? 'var(--primary)' : 'transparent',
                          color: authMethod === 'json' ? '#fff' : 'var(--text-dim)',
                          borderRadius: '6px',
                        }}
                        onClick={() => setAuthMethod('json')}
                      >
                        Service Account JSON / WIF Config
                      </button>
                    </div>
                  </div>

                  <div className="form-input-group">
                    <label htmlFor="adminEmail">Delegated Operator Email (Option A - Restricted Role Recommended)</label>
                    <input
                      id="adminEmail"
                      type="email"
                      className="clean-control"
                      placeholder="operator@company.com"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      required
                    />
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      Email address of the delegated operator account in the Workspace domain. To minimize security risks, it is strongly recommended to use a standard user account assigned a <strong>Custom Admin Role</strong> containing only group member management privileges.
                    </p>
                  </div>

                  {authMethod === 'wif' ? (
                    <div className="form-input-group">
                      <label htmlFor="serviceAccountEmail">Workspace Delegation Service Account Email</label>
                      <input
                        id="serviceAccountEmail"
                        type="email"
                        className="clean-control"
                        placeholder="workspace-sa@your-project.iam.gserviceaccount.com"
                        value={serviceAccountEmail}
                        onChange={(e) => setServiceAccountEmail(e.target.value)}
                        required
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                        Enter the keyless Service Account Email configured with Domain-Wide Delegation. Ensure the portal's running identity has the <strong>Service Account Token Creator</strong> role on this account.
                      </p>
                    </div>
                  ) : (
                    <div className="form-input-group">
                      <label htmlFor="credentials">Service Account JSON or WIF Credential Config (JSON)</label>
                      <textarea
                        id="credentials"
                        className="clean-control"
                        rows={5}
                        placeholder='{ "type": "service_account" or "external_account", ... }'
                        value={serviceAccountJson}
                        onChange={(e) => setServiceAccountJson(e.target.value)}
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                        Paste the service account JSON key or Workload Identity Federation configuration file. {config?.hasServiceAccount && (
                          <strong style={{ color: 'var(--status-active)' }}>✓ Credentials already configured. Leave blank to keep existing.</strong>
                        )}
                      </p>
                    </div>
                  )}

                  <div className="alert-clean" style={{ background: 'rgba(239, 68, 68, 0.03)', borderColor: 'rgba(239, 68, 68, 0.1)', display: 'flex', gap: '0.5rem', padding: '0.75rem', borderRadius: '8px', border: '1px solid' }}>
                    <ShieldAlert size={14} style={{ color: 'var(--status-denied)', flexShrink: 0, marginTop: '0.05rem' }} />
                    <span style={{ fontSize: '0.7rem', lineHeight: '1.4' }}>
                      Ensure the Workspace Delegation Service Account Client ID is authorized in the Google Workspace Admin console under <strong>API Controls &gt; Domain-wide Delegation</strong> with the scope: <code>https://www.googleapis.com/auth/admin.directory.group</code>
                    </span>
                  </div>
                </div>
              )}

              {/* Dynamic ABAC Security Attributes Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--secondary)' }}>
                  <ShieldAlert size={16} />
                  <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>ABAC Security Attribute Definitions</h4>
                </div>
                
                <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: '1.4' }}>
                  Define custom authorization attributes (tags) used to qualify users and group policies. Users must possess these tags to satisfy matching group JIT elevation constraints.
                </p>

                {/* Attributes list */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', margin: '0.4rem 0' }}>
                  {eligibleAttributes.map(attr => (
                    <span key={attr} style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '0.25rem',
                      background: 'rgba(79, 70, 229, 0.05)', 
                      color: 'var(--primary)', 
                      border: '1px solid rgba(79, 70, 229, 0.15)', 
                      padding: '0.2rem 0.45rem', 
                      borderRadius: '6px', 
                      fontSize: '0.75rem', 
                      fontWeight: 600 
                    }}>
                      {attr}
                      <button 
                        type="button" 
                        onClick={() => setEligibleAttributes(eligibleAttributes.filter(a => a !== attr))}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--status-denied)', fontSize: '0.75rem', display: 'flex', alignItems: 'center', padding: '0 0.1rem' }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {eligibleAttributes.length === 0 && (
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem', fontStyle: 'italic' }}>No custom attributes configured. Define one below.</span>
                  )}
                </div>

                {/* Add new attribute input */}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="clean-control"
                    placeholder="e.g. devops-tier-1"
                    style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem' }}
                    value={newAttributeInput}
                    onChange={(e) => setNewAttributeInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  />
                  <button 
                    type="button" 
                    className="clean-btn clean-btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={() => {
                      const val = newAttributeInput.trim().toLowerCase();
                      if (val && !eligibleAttributes.includes(val)) {
                        setEligibleAttributes([...eligibleAttributes, val]);
                        setNewAttributeInput('');
                      }
                    }}
                  >
                    Add Attribute
                  </button>
                </div>
              </div>

              {/* Webhook Notifications Section */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--primary)' }}>
                  <Bell size={16} />
                  <h4 style={{ fontWeight: 700, fontSize: '0.95rem' }}>Global Webhook & Attestation Configuration</h4>
                </div>
                <div className="form-input-group">
                  <label htmlFor="webhookUrl">Global Webhook URL (Optional)</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      id="webhookUrl"
                      type="url"
                      className="clean-control"
                      placeholder="https://hooks.slack.com/services/..."
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="clean-btn clean-btn-secondary"
                      style={{ padding: '0.45rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', height: '38px' }}
                      onClick={() => handleTestWebhook(webhookUrl)}
                    >
                      <Send size={12} /> Test Webhook
                    </button>
                  </div>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                    Incoming webhook integration URL (e.g. Slack, Teams, Google Chat). Alerts will be sent to this channel when global JIT events occur.
                  </p>
                </div>

                <div className="form-input-group">
                  <label htmlFor="attestationIntervalDays">Access Review Attestation Interval (Days)</label>
                  <input
                    id="attestationIntervalDays"
                    type="number"
                    min={1}
                    className="clean-control"
                    placeholder="90"
                    value={attestationIntervalDays}
                    onChange={(e) => setAttestationIntervalDays(Number(e.target.value))}
                  />
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                    Number of days before a group JIT policy requires administrator attestation/recertification.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                <button type="submit" className="clean-btn clean-btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={12} className="spin-loader" /> : <Save size={12} />}
                  Save Global System Settings
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: GLOBAL POLICIES */}
          {activeTab === 'policies' && (
            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div className="form-input-group">
                <label>Eligible Global JIT Groups & Parameter Policies</label>
                
                <input
                  type="text"
                  className="clean-control settings-search-control"
                  placeholder="Search global groups by name or email..."
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                  style={{
                    marginBottom: '0.65rem',
                    padding: '0.45rem 0.75rem',
                    fontSize: '0.85rem'
                  }}
                />

                <div className="settings-checklist-container" style={{ maxHeight: '350px', gap: '0.75rem', overflowY: 'auto', padding: '0.2rem' }}>
                  {groups.length === 0 ? (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Loading groups...</span>
                  ) : (() => {
                    // Filter groups that belong to global domain (do not belong to any space)
                    const globalGroups = groups.filter(g => {
                      const grpDomain = g.email.split('@')[1]?.toLowerCase();
                      const spaceDomains = spaces.map(s => s.domain.toLowerCase());
                      return !spaceDomains.includes(grpDomain);
                    });

                    const filtered = globalGroups.filter(g => 
                      g.name.toLowerCase().includes(groupSearchQuery.toLowerCase()) ||
                      g.email.toLowerCase().includes(groupSearchQuery.toLowerCase())
                    );
                    
                    if (filtered.length === 0) {
                      return <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>No matching global groups found.</span>;
                    }
                    
                    return filtered.map(group => {
                      const policy = groupPolicies.find(p => p.groupEmail.toLowerCase() === group.email.toLowerCase());
                      const isChecked = !!policy;
                      return (
                        <div 
                          key={group.email} 
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.4rem',
                            padding: '0.55rem 0.75rem',
                            borderRadius: '8px',
                            border: isChecked ? '1px solid rgba(79, 70, 229, 0.15)' : '1px solid #e2e8f0',
                            background: isChecked ? 'rgba(79, 70, 229, 0.03)' : '#ffffff',
                            marginBottom: '0.5rem',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <label 
                            style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              gap: '0.6rem',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              color: isChecked ? 'var(--text-main)' : 'var(--text-muted)',
                            }}
                          >
                            <input
                              type="checkbox"
                              style={{ marginTop: '0.15rem', accentColor: 'var(--primary)' }}
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setGroupPolicies([...groupPolicies, {
                                    groupEmail: group.email,
                                    requiredAttributes: []
                                  }]);
                                } else {
                                  setGroupPolicies(groupPolicies.filter(p => p.groupEmail.toLowerCase() !== group.email.toLowerCase()));
                                }
                              }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 600 }}>{group.name}</span>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{group.email}</span>
                            </div>
                          </label>
                          
                          {isChecked && policy && (
                            <div className="policy-attributes-row" style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.8rem',
                              paddingLeft: '1.6rem',
                              marginTop: '0.15rem',
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                              borderTop: '1px dashed #cbd5e1',
                              paddingTop: '0.35rem'
                            }}>
                              <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>Requires parameters:</span>
                              {eligibleAttributes.map((attr) => {
                                const isReqChecked = (policy.requiredAttributes || []).includes(attr);
                                return (
                                  <label key={attr} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', color: isReqChecked ? 'var(--primary)' : 'inherit' }}>
                                    <input 
                                      type="checkbox" 
                                      style={{ accentColor: 'var(--primary)' }}
                                      checked={isReqChecked} 
                                      onChange={(e) => {
                                        const currentReqs = policy.requiredAttributes || [];
                                        const updatedReqs = e.target.checked 
                                          ? [...currentReqs, attr] 
                                          : currentReqs.filter(a => a !== attr);
                                        setGroupPolicies(groupPolicies.map(p => p.groupEmail === group.email ? { ...p, requiredAttributes: updatedReqs } : p));
                                      }}
                                    />
                                    {attr}
                                  </label>
                                );
                              })}
                              {eligibleAttributes.length === 0 && (
                                <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No attributes configured.</span>
                              )}
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', color: policy.autoApproval ? 'var(--status-active)' : 'inherit', marginLeft: 'auto' }}>
                                <input 
                                  type="checkbox" 
                                  style={{ accentColor: 'var(--status-active)' }}
                                  checked={!!policy.autoApproval} 
                                  onChange={(e) => {
                                    setGroupPolicies(groupPolicies.map(p => p.groupEmail === group.email ? { ...p, autoApproval: e.target.checked } : p));
                                  }}
                                />
                                ⚡ Pre-Approved
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    });
                  })()}
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.45rem' }}>
                  Only checked groups above will be requestable under global settings.
                </p>

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="clean-control"
                    placeholder="Manually add group email (e.g. ops-group@company.com)..."
                    value={manualGroupEmail}
                    onChange={(e) => setManualGroupEmail(e.target.value)}
                    style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', flex: 1 }}
                  />
                  <button
                    type="button"
                    className="clean-btn clean-btn-secondary"
                    style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    onClick={handleManualAddGlobalGroup}
                  >
                    Add Group Email
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                <button type="submit" className="clean-btn clean-btn-primary" disabled={saving}>
                  {saving ? <Loader2 size={12} className="spin-loader" /> : <Save size={12} />}
                  Save Global Group Policies
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: SPACES (MULTI-TENANT) */}
          {activeTab === 'spaces' && (
            <div>
              {(!editingSpace && !isCreatingSpace) ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <div>
                      <h4 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>Tenant Spaces</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        Configure tenant domains, delegate emails, and custom credentials.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="clean-btn clean-btn-primary"
                      style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                      onClick={handleAddSpace}
                    >
                      <Plus size={12} /> Add Space
                    </button>
                  </div>

                  {spaces.length === 0 ? (
                    <div style={{
                      textAlign: 'center',
                      padding: '2.5rem',
                      color: 'var(--text-muted)',
                      border: '1px dashed #cbd5e1',
                      borderRadius: '8px',
                      background: 'rgba(15, 23, 42, 0.005)'
                    }}>
                      No Spaces defined yet. Click "Add Space" to configure multi-tenancy.
                    </div>
                  ) : (
                    <div className="aesthetic-table-wrapper">
                      <table className="aesthetic-table">
                        <thead>
                          <tr>
                            <th>Space Name</th>
                            <th>Domain</th>
                            <th>Admin Email</th>
                            <th>Approval</th>
                            <th>Webhook Active</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {spaces.map(space => (
                            <tr key={space.id}>
                              <td style={{ fontWeight: 600 }}>{space.name}</td>
                              <td><code>@{space.domain}</code></td>
                              <td>{space.adminEmail}</td>
                              <td>
                                <span className={`badge-clean ${space.autoApproval ? 'badge-clean-active' : 'badge-clean-pending'}`}>
                                  {space.autoApproval ? 'Auto' : 'Peer'}
                                </span>
                              </td>
                              <td>
                                <span className={`badge-clean ${space.webhookUrl ? 'badge-clean-active' : 'badge-clean-pending'}`}>
                                  {space.webhookUrl ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                                  <button
                                    type="button"
                                    className="clean-btn clean-btn-secondary"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                    onClick={() => handleEditSpace(space)}
                                  >
                                    <Edit size={12} /> Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="clean-btn clean-btn-danger"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                    onClick={() => handleDeleteSpace(space.id)}
                                  >
                                    <Trash2 size={12} /> Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                // Space Add/Edit form
                <form onSubmit={handleSaveSpaceSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <button
                      type="button"
                      className="clean-btn clean-btn-secondary"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                      onClick={() => { setEditingSpace(null); setIsCreatingSpace(false); }}
                    >
                      ← Back to List
                    </button>
                    <h4 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                      {isCreatingSpace ? 'Create Tenant Space' : `Edit Space: ${spaceName}`}
                    </h4>
                  </div>

                  <div className="form-input-group">
                    <label htmlFor="spaceName">Space Name</label>
                    <input
                      id="spaceName"
                      type="text"
                      className="clean-control"
                      placeholder="e.g. Tenant A, Security Dept"
                      value={spaceName}
                      onChange={(e) => setSpaceName(e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-input-group">
                    <label htmlFor="spaceDomain">Space Workspace Domain</label>
                    <input
                      id="spaceDomain"
                      type="text"
                      className="clean-control"
                      placeholder="e.g. tenant-a.com"
                      value={spaceDomain}
                      onChange={(e) => setSpaceDomain(e.target.value)}
                      required
                    />
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                      Target group domain name. Requests for groups under this domain will be routed to this Space's credentials automatically.
                    </p>
                  </div>

                  <div className="settings-toggle-card">
                    <div>
                      <h4 style={{ fontWeight: 600, fontSize: '0.95rem' }}>Space Auto-Approval Policy</h4>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                        Instantly approve JIT memberships for groups belonging to this domain
                      </p>
                    </div>
                    <label className="toggle-switch">
                      <input 
                        type="checkbox" 
                        checked={spaceAutoApproval}
                        onChange={(e) => setSpaceAutoApproval(e.target.checked)}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                  </div>

                  <div className="form-input-group">
                    <label htmlFor="spaceAdminEmail">Delegated Operator Email (Option A - Restricted Role Recommended)</label>
                    <input
                      id="spaceAdminEmail"
                      type="email"
                      className="clean-control"
                      placeholder="operator@tenant-a.com"
                      value={spaceAdminEmail}
                      onChange={(e) => setSpaceAdminEmail(e.target.value)}
                      required
                    />
                    <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                      Email of the delegated operator account for this Space. It is strongly recommended to use a standard user assigned a custom role with only group member modification rights.
                    </p>
                  </div>

                  <div className="form-input-group">
                    <label>Space Authentication Method</label>
                    <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>
                      <button
                        type="button"
                        className="clean-btn btn-sm"
                        style={{
                          padding: '0.3rem 0.6rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: spaceAuthMethod === 'wif' ? 'var(--primary)' : 'transparent',
                          color: spaceAuthMethod === 'wif' ? '#fff' : 'var(--text-dim)',
                          borderRadius: '6px',
                        }}
                        onClick={() => setSpaceAuthMethod('wif')}
                      >
                        Workload Identity (Keyless)
                      </button>
                      <button
                        type="button"
                        className="clean-btn btn-sm"
                        style={{
                          padding: '0.3rem 0.6rem',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: spaceAuthMethod === 'json' ? 'var(--primary)' : 'transparent',
                          color: spaceAuthMethod === 'json' ? '#fff' : 'var(--text-dim)',
                          borderRadius: '6px',
                        }}
                        onClick={() => setSpaceAuthMethod('json')}
                      >
                        Service Account JSON / WIF Config
                      </button>
                    </div>
                  </div>

                  {spaceAuthMethod === 'wif' ? (
                    <div className="form-input-group">
                      <label htmlFor="spaceSaEmail">Workspace Delegation Service Account Email</label>
                      <input
                        id="spaceSaEmail"
                        type="email"
                        className="clean-control"
                        placeholder="workspace-sa@tenant-a.iam.gserviceaccount.com"
                        value={spaceServiceAccountEmail}
                        onChange={(e) => setSpaceServiceAccountEmail(e.target.value)}
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.15rem' }}>
                        Enter the Workspace Delegation Service Account Email. If left blank, this Space will fall back to using global credentials.
                      </p>
                    </div>
                  ) : (
                    <div className="form-input-group">
                      <label htmlFor="spaceCredentials">Service Account JSON or WIF Config (Optional Override)</label>
                      <textarea
                        id="spaceCredentials"
                        className="clean-control"
                        rows={4}
                        placeholder='{ "type": "service_account" or "external_account", ... }'
                        value={spaceServiceAccountJson}
                        onChange={(e) => setSpaceServiceAccountJson(e.target.value)}
                      />
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                        Paste a space-specific service account JSON key or Workload Identity Federation configuration file. {!isCreatingSpace && editingSpace?.serviceAccountJson && (
                          <strong style={{ color: 'var(--status-active)' }}>✓ Credentials already configured. Leave blank to keep existing.</strong>
                        )} If left blank, this Space will fall back to utilizing the global system credentials.
                      </p>
                    </div>
                  )}

                  {/* Space Notification Options */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', borderTop: '1px solid var(--card-border)', paddingTop: '1.25rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--primary)' }}>
                      <Bell size={14} />
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem' }}>Space Webhook URL (Optional)</h4>
                    </div>

                    <div className="form-input-group">
                      <label htmlFor="spaceWebhookUrl">Space Webhook URL</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          id="spaceWebhookUrl"
                          type="url"
                          className="clean-control"
                          placeholder="https://hooks.slack.com/services/..."
                          value={spaceWebhookUrl}
                          onChange={(e) => setSpaceWebhookUrl(e.target.value)}
                          style={{ flex: 1 }}
                        />
                        <button
                          type="button"
                          className="clean-btn clean-btn-secondary"
                          style={{ padding: '0.45rem 0.8rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem', height: '38px' }}
                          onClick={() => handleTestWebhook(spaceWebhookUrl)}
                        >
                          <Send size={12} /> Test Webhook
                        </button>
                      </div>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                        Optional webhook URL. If configured, alerts for groups in this Space will be dispatched here instead of the Global Webhook URL.
                      </p>
                    </div>
                  </div>

                  {/* Space Group Policies Checklist */}
                  <div className="form-input-group" style={{ borderTop: '1px solid var(--card-border)', paddingTop: '1.25rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Space JIT Groups Eligibility Policies</label>
                    
                    <input
                      type="text"
                      className="clean-control settings-search-control"
                      placeholder="Search space groups..."
                      value={spaceGroupSearchQuery}
                      onChange={(e) => setSpaceGroupSearchQuery(e.target.value)}
                      style={{
                        marginBottom: '0.65rem',
                        padding: '0.45rem 0.75rem',
                        fontSize: '0.85rem'
                      }}
                    />

                    <div className="settings-checklist-container" style={{ maxHeight: '200px', gap: '0.75rem', overflowY: 'auto', padding: '0.2rem' }}>
                      {groups.length === 0 ? (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Loading groups...</span>
                      ) : (() => {
                        const spaceGroups = groups;

                        const filtered = spaceGroups.filter(g => 
                          g.name.toLowerCase().includes(spaceGroupSearchQuery.toLowerCase()) ||
                          g.email.toLowerCase().includes(spaceGroupSearchQuery.toLowerCase())
                        );

                        if (filtered.length === 0) {
                          return <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', display: 'block', padding: '1rem 0' }}>No Workspace groups found matching domain: @{spaceDomain}.</span>;
                        }

                        return filtered.map(group => {
                          const policy = spaceGroupPolicies.find(p => p.groupEmail.toLowerCase() === group.email.toLowerCase());
                          const isChecked = !!policy;
                          return (
                            <div 
                              key={group.email} 
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.4rem',
                                padding: '0.55rem 0.75rem',
                                borderRadius: '8px',
                                border: isChecked ? '1px solid rgba(79, 70, 229, 0.15)' : '1px solid #e2e8f0',
                                background: isChecked ? 'rgba(79, 70, 229, 0.03)' : '#ffffff',
                                marginBottom: '0.5rem',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <label 
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: '0.6rem',
                                  cursor: 'pointer',
                                  fontSize: '0.85rem',
                                  color: isChecked ? 'var(--text-main)' : 'var(--text-muted)',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  style={{ marginTop: '0.15rem', accentColor: 'var(--primary)' }}
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSpaceGroupPolicies([...spaceGroupPolicies, {
                                        groupEmail: group.email,
                                        requiredAttributes: []
                                      }]);
                                    } else {
                                      setSpaceGroupPolicies(spaceGroupPolicies.filter(p => p.groupEmail.toLowerCase() !== group.email.toLowerCase()));
                                    }
                                  }}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <span style={{ fontWeight: 600 }}>{group.name}</span>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{group.email}</span>
                                </div>
                              </label>
                              
                              {isChecked && policy && (
                                <div className="policy-attributes-row" style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: '0.8rem',
                                  paddingLeft: '1.6rem',
                                  marginTop: '0.15rem',
                                  fontSize: '0.75rem',
                                  color: 'var(--text-muted)',
                                  borderTop: '1px dashed #cbd5e1',
                                  paddingTop: '0.35rem'
                                }}>
                                  <span style={{ color: 'var(--text-dim)', fontWeight: 600 }}>Requires parameters:</span>
                                  {eligibleAttributes.map((attr) => {
                                    const isReqChecked = (policy.requiredAttributes || []).includes(attr);
                                    return (
                                      <label key={attr} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', color: isReqChecked ? 'var(--primary)' : 'inherit' }}>
                                        <input 
                                          type="checkbox" 
                                          style={{ accentColor: 'var(--primary)' }}
                                          checked={isReqChecked} 
                                          onChange={(e) => {
                                            const currentReqs = policy.requiredAttributes || [];
                                            const updatedReqs = e.target.checked 
                                              ? [...currentReqs, attr] 
                                              : currentReqs.filter(a => a !== attr);
                                            setSpaceGroupPolicies(spaceGroupPolicies.map(p => p.groupEmail === group.email ? { ...p, requiredAttributes: updatedReqs } : p));
                                          }}
                                        />
                                        {attr}
                                      </label>
                                    );
                                  })}
                                  {eligibleAttributes.length === 0 && (
                                    <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>No attributes configured.</span>
                                  )}
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer', color: policy.autoApproval ? 'var(--status-active)' : 'inherit', marginLeft: 'auto' }}>
                                    <input 
                                      type="checkbox" 
                                      style={{ accentColor: 'var(--status-active)' }}
                                      checked={!!policy.autoApproval} 
                                      onChange={(e) => {
                                        setSpaceGroupPolicies(spaceGroupPolicies.map(p => p.groupEmail === group.email ? { ...p, autoApproval: e.target.checked } : p));
                                      }}
                                    />
                                    ⚡ Pre-Approved
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="clean-control"
                        placeholder="Manually add space group email (e.g. engineering@spacea.com)..."
                        value={manualSpaceGroupEmail}
                        onChange={(e) => setManualSpaceGroupEmail(e.target.value)}
                        style={{ fontSize: '0.8rem', padding: '0.45rem 0.75rem', flex: 1 }}
                      />
                      <button
                        type="button"
                        className="clean-btn clean-btn-secondary"
                        style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                        onClick={handleManualAddSpaceGroup}
                      >
                        Add Group Email
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
                    <button 
                      type="button" 
                      className="clean-btn clean-btn-secondary"
                      onClick={() => { setEditingSpace(null); setIsCreatingSpace(false); }}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="clean-btn clean-btn-primary">
                      <Save size={12} />
                      Save Space Config
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 4: ACCESS REVIEWS & ATTESTATIONS */}
          {activeTab === 'reviews' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div>
                <h4 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)', marginBottom: '0.25rem' }}>Access Reviews & Policy Attestation</h4>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Periodically review and certify that configured JIT policies are still necessary. Attesting a policy automatically checks the Google Workspace group for any unauthorized direct members (orphaned access) added outside the portal.
                </p>
              </div>

              {/* SECTION 1: GLOBAL CONFIG POLICIES */}
              <div className="panel-card" style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--card-border)' }}>
                <h5 style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Globe size={14} /> Global Config Policies
                </h5>
                
                {(!groupPolicies || groupPolicies.length === 0) ? (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic', padding: '0.5rem 0' }}>
                    No global policies defined.
                  </div>
                ) : (
                  <div className="aesthetic-table-wrapper">
                    <table className="aesthetic-table" style={{ width: '100%', fontSize: '0.8-rem' }}>
                      <thead>
                        <tr>
                          <th>Group Email</th>
                          <th>Approval</th>
                          <th>Last Certified</th>
                          <th>Status / Next Due</th>
                          <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groupPolicies.map(policy => {
                          const isOverdue = policy.attestationDueAt && new Date(policy.attestationDueAt) < new Date();
                          const orphaned = orphanedAlerts[policy.groupEmail.toLowerCase()];
                          return (
                            <tr key={policy.groupEmail}>
                              <td>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                  <span style={{ fontWeight: 600 }}>{policy.groupEmail}</span>
                                  {orphaned && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--status-denied)', fontWeight: 600 }}>
                                      ⚠️ Direct members bypassing JIT detected: {orphaned.join(', ')}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <span className={`badge-clean ${policy.autoApproval ? 'badge-clean-active' : 'badge-clean-pending'}`}>
                                  {policy.autoApproval ? 'Auto' : 'Peer'}
                                </span>
                              </td>
                              <td>
                                <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column' }}>
                                  <span>{policy.lastCertifiedAt ? new Date(policy.lastCertifiedAt).toLocaleDateString() : 'Never'}</span>
                                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{policy.lastCertifiedBy || 'N/A'}</span>
                                </div>
                              </td>
                              <td>
                                <span className={`badge-clean ${isOverdue ? 'badge-clean-denied' : 'badge-clean-active'}`} style={{ marginRight: '0.4rem' }}>
                                  {isOverdue ? 'Overdue' : 'Active'}
                                </span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                  {policy.attestationDueAt ? new Date(policy.attestationDueAt).toLocaleDateString() : 'N/A'}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <button
                                  type="button"
                                  className="clean-btn clean-btn-secondary"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                  onClick={() => handleAttestPolicy(policy.groupEmail)}
                                  disabled={attestingGroup === policy.groupEmail}
                                >
                                  {attestingGroup === policy.groupEmail ? <Loader2 size={10} className="spin-loader" /> : <ClipboardCheck size={10} />}
                                  Certify
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* SECTION 2: SPACE CONFIG POLICIES */}
              {spaces.map(space => {
                const spacePolicies = space.groupPolicies || [];
                return (
                  <div key={space.id} className="panel-card" style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--card-border)' }}>
                    <h5 style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Database size={14} /> Space Config: {space.name}
                    </h5>
                    
                    {(spacePolicies.length === 0) ? (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic', padding: '0.5rem 0' }}>
                        No JIT policies defined for this Space.
                      </div>
                    ) : (
                      <div className="aesthetic-table-wrapper">
                        <table className="aesthetic-table" style={{ width: '100%', fontSize: '0.8-rem' }}>
                          <thead>
                            <tr>
                              <th>Group Email</th>
                              <th>Approval</th>
                              <th>Last Certified</th>
                              <th>Status / Next Due</th>
                              <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {spacePolicies.map(policy => {
                              const isOverdue = policy.attestationDueAt && new Date(policy.attestationDueAt) < new Date();
                              const orphaned = orphanedAlerts[policy.groupEmail.toLowerCase()];
                              return (
                                <tr key={policy.groupEmail}>
                                  <td>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                      <span style={{ fontWeight: 600 }}>{policy.groupEmail}</span>
                                      {orphaned && (
                                        <span style={{ fontSize: '0.7rem', color: 'var(--status-denied)', fontWeight: 600 }}>
                                          ⚠️ Direct members bypassing JIT detected: {orphaned.join(', ')}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`badge-clean ${policy.autoApproval ? 'badge-clean-active' : 'badge-clean-pending'}`}>
                                      {policy.autoApproval ? 'Auto' : 'Peer'}
                                    </span>
                                  </td>
                                  <td>
                                    <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column' }}>
                                      <span>{policy.lastCertifiedAt ? new Date(policy.lastCertifiedAt).toLocaleDateString() : 'Never'}</span>
                                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{policy.lastCertifiedBy || 'N/A'}</span>
                                    </div>
                                  </td>
                                  <td>
                                    <span className={`badge-clean ${isOverdue ? 'badge-clean-denied' : 'badge-clean-active'}`} style={{ marginRight: '0.4rem' }}>
                                      {isOverdue ? 'Overdue' : 'Active'}
                                    </span>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                      {policy.attestationDueAt ? new Date(policy.attestationDueAt).toLocaleDateString() : 'N/A'}
                                    </span>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>
                                    <button
                                      type="button"
                                      className="clean-btn clean-btn-secondary"
                                      style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
                                      onClick={() => handleAttestPolicy(policy.groupEmail, space.id)}
                                      disabled={attestingGroup === policy.groupEmail}
                                    >
                                      {attestingGroup === policy.groupEmail ? <Loader2 size={10} className="spin-loader" /> : <ClipboardCheck size={10} />}
                                      Certify
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}


        </div>
      </div>
    </div>
  );
}
