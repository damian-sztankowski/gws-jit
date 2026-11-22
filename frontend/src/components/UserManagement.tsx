import { useState, useEffect } from 'react';
import { Search, UserPlus, Edit2, Trash2, AlertCircle } from 'lucide-react';
import { User, UserRole, SpaceConfig } from '../types.ts';
import { getAuthHeaders } from '../api.ts';
import { Modal, ConfirmDialog } from './Modal.tsx';

interface UserManagementProps {
  currentUser: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  refreshTrigger?: number;
  eligibleAttributes: string[];
}

export default function UserManagement({
  currentUser,
  showToast,
  refreshTrigger,
  eligibleAttributes
}: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('REQUESTER');
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [assignedSpaces, setAssignedSpaces] = useState<string[]>([]);

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchSpaces = async () => {
    try {
      const res = await fetch('/api/spaces', { headers: getAuthHeaders() });
      if (res.ok) {
        setSpaces(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch spaces', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users', { headers: getAuthHeaders() });
      if (res.ok) {
        setUsers(await res.json());
      } else {
        showToast('Failed to retrieve user directory.', 'error');
      }
    } catch {
      showToast('Network error while retrieving users.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchSpaces();
  }, [refreshTrigger]);

  const openAddModal = () => {
    setEditingUser(null);
    setEmail('');
    setName('');
    setPassword('');
    setRole('REQUESTER');
    setSelectedAttributes([]);
    setAssignedSpaces(['global']);
    setFormError('');
    setIsModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setEmail(user.email);
    setName(user.name);
    setPassword('');
    setRole(user.role);
    setSelectedAttributes(user.attributes || []);
    setAssignedSpaces(user.assignedSpaces || []);
    setFormError('');
    setIsModalOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(deleteTarget.email)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast(`Deleted ${deleteTarget.name}.`, 'success');
        fetchUsers();
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Failed to delete user.', 'error');
      }
    } catch {
      showToast('Network error during user deletion.', 'error');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) {
      setFormError('Name and email are required.');
      return;
    }
    if (!editingUser && !password.trim()) {
      setFormError('Password is required for new accounts.');
      return;
    }

    setSubmitting(true);
    setFormError('');

    const payload = {
      email: email.trim(),
      name: name.trim(),
      role,
      password,
      attributes: selectedAttributes,
      assignedSpaces
    };

    try {
      const url = editingUser
        ? `/api/users/${encodeURIComponent(editingUser.email)}`
        : '/api/users';
      const method = editingUser ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: getAuthHeaders(true),
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        showToast(
          editingUser ? `Updated ${name}.` : `Created ${name}.`,
          'success'
        );
        setIsModalOpen(false);
        fetchUsers();
      } else {
        setFormError(data.error || 'Failed to save user.');
      }
    } catch {
      setFormError('Network error while saving user.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const rolePillClass = (r: UserRole) => {
    if (r === 'ADMIN') return 'pill-denied';
    if (r === 'APPROVER') return 'pill-pending';
    if (r === 'REQUESTER') return 'pill-active';
    return 'pill-neutral';
  };

  return (
    <section className="surface-card">
      <div className="card-header">
        <div className="input-wrap" style={{ maxWidth: '300px' }}>
          <Search size={15} className="input-icon" />
          <input
            type="text"
            className="input input--with-icon"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-primary" onClick={openAddModal}>
          <UserPlus size={15} />
          New user
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>ABAC attributes</th>
              <th>Spaces</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  Loading users...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
                  No matching users found.
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const isSelf = u.email.toLowerCase() === currentUser.email.toLowerCase();
                return (
                  <tr key={u.email}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{u.name}</div>
                      <div className="text-mono text-muted" style={{ fontSize: '0.72rem' }}>{u.email}</div>
                    </td>
                    <td>
                      <span className={`pill ${rolePillClass(u.role)}`}>{u.role}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                        {(u.attributes || []).length > 0 ? (
                          u.attributes.map((attr) => (
                            <span key={attr} className="tag-chip">
                              {attr}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="text-muted tabular" style={{ fontSize: '0.78rem' }}>
                        {u.role === 'ADMIN'
                          ? 'All spaces'
                          : (u.assignedSpaces || []).length > 0
                            ? `${(u.assignedSpaces || []).length} assigned`
                            : 'None'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.25rem' }}>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => openEditModal(u)}
                          title="Edit user"
                          aria-label={`Edit ${u.email}`}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => !isSelf && setDeleteTarget(u)}
                          disabled={isSelf}
                          title={isSelf ? 'Cannot delete own account' : 'Delete user'}
                          aria-label={`Delete ${u.email}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingUser ? 'Edit user' : 'Create user'}
        description="Configure portal role, ABAC attributes, and space access."
        maxWidth="500px"
        footer={
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              form="user-crud-form"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? 'Saving...' : editingUser ? 'Save changes' : 'Create user'}
            </button>
          </>
        }
      >
        <form id="user-crud-form" onSubmit={handleSubmit}>
          {formError && (
            <div className="callout callout--danger" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{formError}</span>
            </div>
          )}

          <div className="field">
            <label htmlFor="user-email" className="field-label">Work email</label>
            <input
              id="user-email"
              type="email"
              className="input"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={Boolean(editingUser)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="user-name" className="field-label">Display name</label>
            <input
              id="user-name"
              type="text"
              className="input"
              placeholder="Jane Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="user-password" className="field-label">
              {editingUser ? 'New password (optional)' : 'Initial password'}
            </label>
            <input
              id="user-password"
              type="password"
              className="input"
              placeholder={editingUser ? 'Leave blank to keep existing password' : 'Minimum 8 characters'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required={!editingUser}
            />
          </div>

          <div className="field">
            <label htmlFor="user-role" className="field-label">Role</label>
            <select
              id="user-role"
              className="select"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              disabled={editingUser?.email.toLowerCase() === currentUser.email.toLowerCase()}
            >
              <option value="REQUESTER">REQUESTER — Submit JIT elevation requests</option>
              <option value="APPROVER">APPROVER — Request & peer-approve elevations</option>
              <option value="ADMIN">ADMIN — Full portal & policy administration</option>
              <option value="AUDITOR">AUDITOR — Read-only compliance & audit access</option>
            </select>
            {editingUser?.email.toLowerCase() === currentUser.email.toLowerCase() && (
              <p className="field-hint">Lockout guard: you cannot demote your own admin role.</p>
            )}
          </div>

          <div className="field">
            <span className="field-label">ABAC attributes</span>
            {eligibleAttributes.length === 0 ? (
              <p className="field-hint">No attributes defined in Settings.</p>
            ) : (
              <div className="check-grid">
                {eligibleAttributes.map((attr) => {
                  const checked = selectedAttributes.includes(attr);
                  return (
                    <label
                      key={attr}
                      className={`check-tile ${checked ? 'check-tile--checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setSelectedAttributes(
                            e.target.checked
                              ? [...selectedAttributes, attr]
                              : selectedAttributes.filter((a) => a !== attr)
                          )
                        }
                      />
                      <span>{attr}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="field">
            <span className="field-label">Assigned spaces</span>
            <div className="check-grid">
              {(() => {
                const isGlobal = assignedSpaces.includes('global');
                return (
                  <label className={`check-tile ${isGlobal ? 'check-tile--checked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isGlobal}
                      onChange={(e) =>
                        setAssignedSpaces(
                          e.target.checked
                            ? [...assignedSpaces, 'global']
                            : assignedSpaces.filter((id) => id !== 'global')
                        )
                      }
                    />
                    <span>Global</span>
                  </label>
                );
              })()}
              {spaces.map((space) => {
                const checked = assignedSpaces.includes(space.id);
                return (
                  <label
                    key={space.id}
                    className={`check-tile ${checked ? 'check-tile--checked' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setAssignedSpaces(
                          e.target.checked
                            ? [...assignedSpaces, space.id]
                            : assignedSpaces.filter((id) => id !== space.id)
                        )
                      }
                    />
                    <span>{space.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete user account?"
        message={
          deleteTarget
            ? `Permanently remove ${deleteTarget.name} (${deleteTarget.email}) from the JIT portal?`
            : ''
        }
        confirmLabel="Delete user"
        tone="danger"
        onConfirm={confirmDeleteUser}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
