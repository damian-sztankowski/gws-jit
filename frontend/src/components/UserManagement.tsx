import { useState, useEffect } from 'react';
import { Search, UserPlus, Edit2, Trash2, Key, Shield, User as UserIcon, X } from 'lucide-react';
import { User, UserRole, SpaceConfig } from '../types.ts';

interface UserManagementProps {
  currentUser: User;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  refreshTrigger?: number;
  eligibleAttributes: string[];
}

export default function UserManagement({ currentUser, showToast, refreshTrigger, eligibleAttributes }: UserManagementProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Spaces state
  const [spaces, setSpaces] = useState<SpaceConfig[]>([]);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  // Form states
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('REQUESTER');
  const [selectedAttributes, setSelectedAttributes] = useState<string[]>([]);
  const [assignedSpaces, setAssignedSpaces] = useState<string[]>([]);
  
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchSpaces = async () => {
    const token = localStorage.getItem('jit_token');
    if (!token) return;
    try {
      const res = await fetch('/api/spaces', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSpaces(data);
      }
    } catch (err) {
      console.error("Failed to fetch spaces", err);
    }
  };

  const fetchUsers = async () => {
    const token = localStorage.getItem('jit_token');
    if (!token) return;
    try {
      const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      } else {
        showToast("Failed to retrieve user list.", "error");
      }
    } catch (err) {
      showToast("Network error while retrieving users.", "error");
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
    setAssignedSpaces([]);
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

  const handleDelete = async (userToDelete: User) => {
    if (userToDelete.email.toLowerCase() === currentUser.email.toLowerCase()) {
      showToast("Lockout Guard: You cannot delete your own active Admin account.", "error");
      return;
    }
    
    if (!window.confirm(`Are you sure you want to delete user ${userToDelete.name} (${userToDelete.email})?`)) {
      return;
    }

    const token = localStorage.getItem('jit_token');
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(userToDelete.email)}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showToast(`User ${userToDelete.name} deleted successfully.`, "success");
        fetchUsers();
      } else {
        const errData = await res.json();
        showToast(errData.error || "Failed to delete user.", "error");
      }
    } catch (err) {
      showToast("Network error during user deletion.", "error");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !name.trim()) {
      setFormError('Please fill out Name and Email.');
      return;
    }
    if (!editingUser && !password.trim()) {
      setFormError('Please enter a password for the new account.');
      return;
    }

    setSubmitting(true);
    setFormError('');
    const token = localStorage.getItem('jit_token');
    
    const payload = {
      email: email.trim(),
      name: name.trim(),
      role,
      password,
      attributes: selectedAttributes,
      assignedSpaces
    };

    try {
      const url = editingUser ? `/api/users/${encodeURIComponent(editingUser.email)}` : '/api/users';
      const method = editingUser ? 'PUT' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        showToast(
          editingUser ? `User ${name} updated successfully.` : `User ${name} created successfully.`,
          "success"
        );
        setIsModalOpen(false);
        fetchUsers();
      } else {
        setFormError(data.error || "Failed to save user.");
      }
    } catch (err) {
      setFormError("Network error. Unable to save user.");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter(
    u => u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
         u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="tab-viewport">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <div className="input-with-icon" style={{ width: '300px' }}>
          <Search size={16} className="field-icon" />
          <input
            type="text"
            className="clean-control"
            placeholder="Search users by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="clean-btn" onClick={openAddModal} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <UserPlus size={16} />
          Add User Account
        </button>
      </div>

      <div className="aesthetic-table-wrapper">
        <table className="aesthetic-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email Address</th>
              <th>Portal Role</th>
              <th>ABAC Attributes</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                  Loading user records...
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '2rem' }}>
                  No user accounts found matching your search.
                </td>
              </tr>
            ) : (
              filteredUsers.map(u => (
                <tr key={u.email}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <span className="badge-clean" style={{
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      background: u.role === 'ADMIN' ? 'var(--status-denied-bg)' : u.role === 'APPROVER' ? 'var(--status-pending-bg)' : u.role === 'AUDITOR' ? 'var(--status-expired-bg)' : 'var(--status-active-bg)',
                      color: u.role === 'ADMIN' ? 'var(--status-denied)' : u.role === 'APPROVER' ? 'var(--status-pending)' : u.role === 'AUDITOR' ? 'var(--status-expired)' : 'var(--status-active)',
                      border: '1px solid currentColor'
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {(u.attributes || []).map((attr) => (
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
                          padding: '0.05rem 0.25rem', 
                          borderRadius: '4px', 
                          fontSize: '0.65rem', 
                          fontWeight: 600 
                        }}>
                          {attr}
                        </span>
                      ))}
                      {(!u.attributes || u.attributes.length === 0) && <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', fontStyle: 'italic' }}>None</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button 
                        className="clean-btn clean-btn-secondary" 
                        onClick={() => openEditModal(u)} 
                        style={{ padding: '0.3rem 0.5rem' }}
                        title="Edit User"
                      >
                        <Edit2 size={12} />
                      </button>
                      <button 
                        className="clean-btn clean-btn-secondary" 
                        onClick={() => handleDelete(u)} 
                        style={{ padding: '0.3rem 0.5rem', color: u.email.toLowerCase() === currentUser.email.toLowerCase() ? 'var(--text-dim)' : 'var(--status-denied)' }}
                        disabled={u.email.toLowerCase() === currentUser.email.toLowerCase()}
                        title="Delete User"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* CRUD Modal Overlay */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>
                <UserIcon className="logo-icon" size={16} />
                {editingUser ? 'Edit User Profile' : 'Create New User Profile'}
              </h3>
              <button className="modal-close-btn" onClick={() => setIsModalOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formError && (
                <div className="login-error-banner" style={{ margin: 0 }}>
                  <Shield size={16} />
                  <span>{formError}</span>
                </div>
              )}

              <div className="form-input-group">
                <label>User Email address</label>
                <div className="input-with-icon">
                  <Shield size={16} className="field-icon" />
                  <input
                    type="email"
                    className="clean-control"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={!!editingUser}
                    required
                  />
                </div>
              </div>

              <div className="form-input-group">
                <label>Display Name</label>
                <div className="input-with-icon">
                  <UserIcon size={16} className="field-icon" />
                  <input
                    type="text"
                    className="clean-control"
                    placeholder="e.g. John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-input-group">
                <label>{editingUser ? 'Reset Password (Optional)' : 'Set Account Password'}</label>
                <div className="input-with-icon">
                  <Key size={16} className="field-icon" />
                  <input
                    type="password"
                    className="clean-control"
                    placeholder={editingUser ? "Leave blank to keep existing" : "Set password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required={!editingUser}
                  />
                </div>
              </div>

              <div className="form-input-group">
                <label>Access Role</label>
                <select 
                  className="clean-control"
                  style={{ background: '#ffffff' }}
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  disabled={editingUser?.email.toLowerCase() === currentUser.email.toLowerCase()}
                >
                  <option value="REQUESTER">REQUESTER - Can submit JIT elevations</option>
                  <option value="APPROVER">APPROVER - Can request and approve elevations</option>
                  <option value="ADMIN">ADMIN - Full Portal administrator privileges</option>
                  <option value="AUDITOR">AUDITOR - Read-only view of Elevation logs</option>
                </select>
                {editingUser?.email.toLowerCase() === currentUser.email.toLowerCase() && (
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontStyle: 'italic', marginTop: '0.2rem' }}>
                    Lockout Guard: You cannot change your own admin role.
                  </span>
                )}
              </div>

              <div style={{ borderTop: '1px dashed rgba(15, 23, 42, 0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '0.5rem' }}>
                  ABAC Attributes Checklist
                </span>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                  {eligibleAttributes.map(attr => {
                    const isChecked = selectedAttributes.includes(attr);
                    return (
                      <label key={attr} className={`settings-checklist-item ${isChecked ? 'checked' : ''}`} style={{ padding: '0.5rem', cursor: 'pointer', border: '1px solid rgba(15, 23, 42, 0.05)' }}>
                        <input 
                          type="checkbox" 
                          style={{ marginRight: '0.5rem' }} 
                          checked={isChecked} 
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAttributes([...selectedAttributes, attr]);
                            } else {
                              setSelectedAttributes(selectedAttributes.filter(a => a !== attr));
                            }
                          }} 
                        />
                        <span style={{ textTransform: 'capitalize' }}>{attr.replace('-', ' ').replace('_', ' ')}</span>
                      </label>
                    );
                  })}
                  {eligibleAttributes.length === 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      No attributes defined in System Settings.
                    </span>
                  )}
                </div>
              </div>

              <div style={{ borderTop: '1px dashed rgba(15, 23, 42, 0.08)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', display: 'block', marginBottom: '0.5rem' }}>
                  Assigned Spaces Access
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                  {/* Global Config Checkbox */}
                  {(() => {
                    const isGlobalChecked = assignedSpaces.includes('global');
                    return (
                      <label 
                        className={`settings-checklist-item ${isGlobalChecked ? 'checked' : ''}`} 
                        style={{ 
                          padding: '0.5rem', 
                          cursor: 'pointer', 
                          border: '1px solid rgba(15, 23, 42, 0.05)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: '0.3rem', 
                          fontSize: '0.8rem', 
                          gridColumn: 'span 2', 
                          background: isGlobalChecked ? 'rgba(79, 70, 229, 0.03)' : 'transparent',
                          borderRadius: '6px'
                        }}
                      >
                        <input 
                          type="checkbox" 
                          checked={isGlobalChecked} 
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignedSpaces([...assignedSpaces, 'global']);
                            } else {
                              setAssignedSpaces(assignedSpaces.filter(id => id !== 'global'));
                            }
                          }} 
                        />
                        <strong style={{ color: 'var(--primary)' }}>Global Config</strong>
                      </label>
                    );
                  })()}

                  {spaces.map(space => {
                    const isChecked = assignedSpaces.includes(space.id);
                    return (
                      <label 
                        key={space.id} 
                        className={`settings-checklist-item ${isChecked ? 'checked' : ''}`} 
                        style={{ padding: '0.5rem', cursor: 'pointer', border: '1px solid rgba(15, 23, 42, 0.05)', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', borderRadius: '6px' }}
                      >
                        <input 
                          type="checkbox" 
                          checked={isChecked} 
                          onChange={(e) => {
                            if (e.target.checked) {
                              setAssignedSpaces([...assignedSpaces, space.id]);
                            } else {
                              setAssignedSpaces(assignedSpaces.filter(id => id !== space.id));
                            }
                          }} 
                        />
                        <span>{space.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem', borderTop: '1px solid rgba(15, 23, 42, 0.05)', paddingTop: '1rem' }}>
                <button 
                  type="button" 
                  className="clean-btn clean-btn-secondary" 
                  onClick={() => setIsModalOpen(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="clean-btn"
                  disabled={submitting}
                >
                  {submitting ? 'Saving changes...' : editingUser ? 'Update Profile' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
