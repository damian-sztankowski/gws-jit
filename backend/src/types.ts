export interface JitRequest {
  id: string;
  requesterEmail: string;
  groupEmail: string;
  groupName: string;
  justification: string;
  durationMinutes: number;
  requestedAt: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  approverEmail?: string;
  approvedAt?: string;
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

export type UserRole = 'REQUESTER' | 'APPROVER' | 'ADMIN' | 'AUDITOR';

export interface User {
  email: string;
  name: string;
  role: UserRole;
  password?: string;
  attributes: string[]; // Dynamic ABAC attribute tags
  assignedSpaces?: string[]; // Spaces the user is assigned to
}

export interface GroupJitPolicy {
  groupEmail: string;
  requiredAttributes: string[]; // Dynamic ABAC attribute tags required
  autoApproval?: boolean;
  lastCertifiedAt?: string;   // ISO timestamp
  lastCertifiedBy?: string;   // Admin email who certified it
  attestationDueAt?: string;  // Calculated due date
}

export interface SpaceConfig {
  id: string;
  name: string;
  domain: string;
  adminEmail: string;
  serviceAccountEmail?: string; // Optional keyless SA email
  serviceAccountJson?: string; // Optional (falls back to global)
  autoApproval: boolean;
  groupPolicies?: GroupJitPolicy[];
  webhookUrl?: string;
}

export interface AppConfig {
  mode: 'MOCK' | 'LIVE';
  domain: string;
  serviceAccountEmail?: string; // Optional keyless SA email
  serviceAccountJson?: string;
  adminEmail?: string;
  autoApproval: boolean;
  groupPolicies?: GroupJitPolicy[];
  eligibleGroupEmails?: string[]; // Kept for backward compatibility migrations
  spaces?: SpaceConfig[]; // Multi-tenant spaces
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
