# GWS JIT Access Portal - User Manual & Settings Reference

This manual provides a detailed reference and explanation of every configuration option, user role, and setting in the GWS JIT Access Portal.

---

## 1. Access Command Center & JIT Requests

The **Command Center** is the main dashboard where users request time-bound group elevations and review their active/pending requests.

* **Active Space Selection**: Specifies the context for your workspace (Global vs. Specific Tenant). Changing the space filters the available JIT groups and request listings.
* **Select JIT Group**: The target Google Group you want to join. Only groups with configured JIT policies in the active Space will be displayed.
* **Duration**: The time limit for group membership. Once this time expires, the background scheduler automatically revokes access.
* **Justification**: A mandatory description detailing why elevation is required. This justification is logged permanently for security auditing.

---

## 2. Portal Settings - System Config

Only users with the **ADMIN** role can access and modify settings.

### Core Settings
* **Engine Mode**:
  * `MOCK`: Simulates Google Directory API changes in memory. Ideal for local testing and configuration verification.
  * `LIVE`: Provisions real group membership additions and removals in the live Google Workspace directory.
* **Workspace Domain**: The primary G Suite/Workspace domain managed by this installation (e.g., `company.com`).
* **Delegated Operator Email**: A standard Workspace account (non-super-admin is recommended) configured with group management privileges. The GCP Service Account impersonates this email to modify group memberships using Domain-Wide Delegation.
* **Access Review Attestation Interval (Days)**: The period (default: `90` days) after which a group policy requires administrator re-certification.

### Integration & Alerts
* **Global Webhook Notification URL**: Fallback Slack, Teams, or Google Chat incoming webhook URL. The portal posts JSON alerts on request states (`PENDING`, `APPROVED`, `DENIED`, `REVOKED`/`EXPIRED`).
* **Test Webhook Button**: Verifies network connectivity and payload formats by firing a test notification instantly.

### Credentials Configuration
* **Workload Identity Federation (Keyless)**: Recommended keyless authentication method. The JIT Portal exchanges its ambient GCP compute identity for a temporary delegation token.
  * *Required Input:* **Workspace Delegation Service Account Email**
* **Service Account JSON / WIF Config**: Traditional credentials method. Paste the complete service account JSON private key file content.

---

## 3. Portal Settings - Global Policies

Manage JIT access rules applied globally to the primary Workspace domain.

* **Group JIT Policy List**: Displays Google Groups discovered via the Directory API or added manually.
* **⚡ Pre-Approved Option**: If enabled, JIT requests to join this group bypass the Approver review queue. The system provisions group membership immediately.
* **Required Attribute Tags**: Attribute tags that a user must possess to be eligible to request this group (Attribute-Based Access Control).
* **Manual Add Group**: Allows administrators to configure policies for arbitrary group emails directly, bypassing Directory API listing synchronization.

---

## 4. Portal Settings - Spaces (Multi-Tenant)

Spaces allow Managed Service Providers (MSPs) and large enterprises to isolate separate Workspace domains, JIT policies, and notifications.

* **Space Name**: Unique label for the tenant environment.
* **Space Domain**: The specific Workspace domain assigned to this Space.
* **Delegated Operator Email**: Tenant-specific administrator account for impersonation.
* **Space Webhook URL**: Route alerts (like approvals and warnings) to tenant-specific Slack/Teams channels.
* **Credentials JSON Override**: Paste a dedicated service account JSON key to route API calls using the tenant's own GCP credentials. If left blank, it falls back to the global credentials.

---

## 5. Portal Settings - Access Reviews & Attestation

To satisfy SOC2 and ISO compliance requirements, JIT group policies must be periodically reviewed and re-certified.

* **JIT Policy Listing**: Displays configured policies, their last attested timestamp, and the user who certified them.
* **Certify Button**: Performs a compliance attestation audit:
  1. Extends the policy's next due date by the attestation interval.
  2. Queries the Directory API for active members in the Google Group.
  3. Matches members against active requests database.
  4. Flags **orphaned access** (members added out-of-band directly in GWS instead of the JIT portal) and dispatches webhook alerts.

---

## 6. User Accounts & Attribute-Based Access Control (ABAC)

Manage user profiles, permissions, and security roles.

### User Roles
* **ADMIN**: Full system rights. Can view/modify settings, manage users, request JIT, and approve memberships.
* **APPROVER**: Reviewers who approve or deny pending requests. They cannot submit requests for themselves or modify system settings.
* **REQUESTER**: Standard users. They can request time-bound elevations and view their own request dashboard.
* **AUDITOR**: Read-only access to the Central Security Audit Trail. They cannot request, approve, or change settings.

### ABAC Attribute Tags
* **Eligible Attributes**: Defined under *Settings > System Config*, these are system-wide tag keys (e.g. `oncall`, `cdt`, `security`).
* **User Attribute Assignment**: Edit a user's account to assign tags. The user must possess *all* attribute tags required by a JIT policy to request that group.
