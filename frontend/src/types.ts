export type UserRole = 'REQUESTER' | 'APPROVER' | 'ADMIN' | 'AUDITOR';

export interface User {
  email: string;
  name: string;
  role: UserRole;
  password?: string;
  attributes: string[]; // Dynamic ABAC attribute tags
  assignedSpaces?: string[]; // Spaces the user is assigned to
}

export interface JitApprovalEntry {
  approverEmail: string;
  approvedAt: string;
  note?: string;
}

export interface GroupJitPolicy {
  groupEmail: string;
  requiredAttributes: string[]; // Dynamic ABAC attribute tags required
  autoApproval?: boolean;
  maxDurationMinutes?: number;  // Optional per-group max TTL (default 240)
  requiredApprovals?: number;   // Peer approval quorum (1 or 2, default 1)
  allowBreakGlass?: boolean;    // Allow emergency break-glass 30m elevation
  lastCertifiedAt?: string;     // ISO timestamp
  lastCertifiedBy?: string;     // Admin email who certified it
  attestationDueAt?: string;    // Calculated due date
}

export interface JitRequest {
  id: string;
  requesterEmail: string;
  groupEmail: string;
  groupName: string;
  justification: string;
  ticketId?: string;
  isBreakGlass?: boolean;
  durationMinutes: number;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  approverEmail?: string;
  approvedAt?: string;
  reviewNote?: string;
  approvals?: JitApprovalEntry[];
  requiredApprovals?: number;
  extendedCount?: number;
  activatedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  spaceId?: string; // Space ID this request belongs to
}

export interface WorkspaceGroup {
  email: string;
  name: string;
  description?: string;
}

export interface SpaceConfig {
  id: string;
  name: string;
  domain: string;
  adminEmail: string;
  serviceAccountEmail?: string;
  serviceAccountJson?: string;
  hasServiceAccount?: boolean;
  autoApproval: boolean;
  groupPolicies?: GroupJitPolicy[];
  webhookUrl?: string;
}

export interface AppConfig {
  mode: 'MOCK' | 'LIVE';
  domain: string;
  serviceAccountEmail?: string;
  serviceAccountJson?: string;
  adminEmail?: string;
  autoApproval: boolean;
  hasServiceAccount?: boolean;
  groupPolicies?: GroupJitPolicy[];
  eligibleGroupEmails?: string[];
  spaces?: SpaceConfig[];
  webhookUrl?: string;
  eligibleAttributes?: string[]; // Configurable global system attribute tags
  attestationIntervalDays?: number; // Policy attestation interval in days
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
}
