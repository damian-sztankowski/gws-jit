# Operator Manual & Governance Reference

This manual documents operational workflows, policy governance, custody quorums, emergency break-glass procedures, and API endpoints for the **GWS JIT Privileged Access Console**.

---

## Access Control & Elevation Requests

The **Operations / Access Control** workspace is the primary console for requesting time-bounded Google Workspace group memberships and reviewing peer elevation queues.

* **Directory Scope Switcher:** Selects the active Workspace tenant boundary (`Global` or an isolated multi-tenant `Space`). Only groups, active grants, and history belonging to the selected scope are displayed.
* **Target Workspace Group:** Interactive group selection filtered dynamically by the signed-in operator's ABAC attribute tags. Each card surfaces policy posture (`AUTO`, `2-PEER`, and privilege description).
* **Lease TTL:** Bounded elevation window (`30m`, `1h`, `2h`, `4h`), constrained by the target policy's `maxDurationMinutes` ceiling.
* **Ticket / Change ID:** Structured incident or change reference (for example `INC-4821` or `CHG-902`) persisted across the custody queue, webhook alerts, and immutable audit ledger.
* **Operational Justification:** Mandatory statement of administrative intent recorded permanently in the audit ledger.

### Live Lease Extensions & Early Revocation

* **+30m Lease Extension:** Operators (or `ADMIN` principals) may extend an active standard lease by `30` minutes up to `2` times, provided total duration remains within the group policy's `maxDurationMinutes` cap.
* **Immediate Revocation:** Principals may terminate their own active lease early (`Revoke`) once maintenance is complete, immediately invoking `Directory.Members.delete()`.

---

## Dual-Custody Peer Quorum & Break-Glass

### Single & Two-Peer Custody Quorums

> [!IMPORTANT]
> Self-approval is cryptographically and logically blocked across all endpoints. A principal can never authorize or deny their own elevation request.

* **1-Peer Review (Default):** Requires authorization from one independent `APPROVER` or `ADMIN` assigned to the target Space.
* **2-Peer Tier-0 Quorum:** High-impact groups (such as `gws-super-admins`) can enforce `requiredApprovals: 2`. The first reviewer transitions the request to `QUORUM 1/2` while keeping directory access unprovisioned; the second distinct reviewer triggers `Directory.Members.insert()` and starts the lease timer.
* **Audit Review Notes:** Reviewers can attach structured verification comments or rejection reasons during approval or denial.

### P0 Emergency Break-Glass

> [!CAUTION]
> Break-glass bypasses peer custody waiting queues and immediately dispatches a high-severity alert to configured Slack, Google Chat, or Microsoft Teams security channels.

For groups with `allowBreakGlass: true`, principals holding the `oncall` ABAC tag (or `ADMIN` role) can invoke **Emergency break-glass**:

1. **Mandatory Incident ID:** Requires a valid incident ticket (`INC-...`).
2. **Strict 30-Minute Cap:** Lease duration is locked to `30` minutes and cannot be extended.
3. **Immutable Telemetry:** Logged under event type `BREAK_GLASS_JIT` for post-incident security review.

---

## Policies, Credentials & Multi-Tenant Spaces

> [!WARNING]
> Access to **Governance / Policies & Spaces** and **Governance / Identities** is restricted strictly to `ADMIN` principals.

### Directory Engine & Keyless Workload Identity

| Setting | Technical Behavior |
| :--- | :--- |
| **MOCK Engine** | Simulates Google Workspace Directory SDK calls in memory for local evaluation and policy testing. |
| **LIVE Engine** | Executes authenticated `admin.directory.v1` group and membership mutations against Google Workspace. |
| **Workload Identity (Keyless)** | Uses GCP `iamcredentials.googleapis.com` (`signJwt`) to mint short-lived OAuth2 tokens (cached 55m) with zero stored private keys. |
| **Delegated Operator Email** | Dedicated Workspace account assigned a custom least-privilege Admin Role (`Groups > Read`, `Groups > Update`, `Users > Read`). |

### Group Policy Parameters

| Policy Control | Values | Enforcement |
| :--- | :--- | :--- |
| **Required Tags** | Dynamic ABAC tags (`security`, `oncall`, `cdt`) | Requester must hold **all** specified tags to view or request the group. |
| **Max TTL** | `30m`, `1h`, `2h`, `4h` | Caps initial lease requests and `+30m` session extensions. |
| **Custody Quorum** | `1 peer` or `2 peers` | Distinct independent approvals required prior to provisioning. |
| **Pre-Approved** | Boolean | Provisions immediately upon ABAC validation without manual review. |
| **Allow Break-Glass** | Boolean | Permits `oncall` / `ADMIN` principals to invoke 30m P0 instant access. |

### Multi-Tenant Spaces

Managed Service Providers (MSPs) and multi-domain enterprises can isolate secondary Workspace domains under **Tenant Spaces**. Each Space binds a dedicated `@domain`, delegated operator account, optional Workload Identity service account override, isolated group policies, and tenant-specific webhook routing.

---

## Access Reviews & Drift Remediation

To satisfy **SOC 2 Type II** and **ISO/IEC 27001** access recertification controls, every group policy tracks `lastCertifiedAt`, `lastCertifiedBy`, and `attestationDueAt`.

1. Navigate to **Governance / Policies & Spaces → Access reviews**.
2. Click **Certify** on any global or Space group policy to execute live directory reconciliation:
   * Paginates `admin.members.list` across the Google Workspace group.
   * Cross-references live directory members against active JIT leases in the database.
   * Flags any unauthorized standing member (**orphaned access**) bypassing JIT governance and dispatches a security webhook warning.
3. Click **Remove** next to any flagged orphaned member to invoke one-click `Directory.Members.delete()` remediation (`REMEDIATE_ORPHANED_ACCESS`).

---

## RBAC Role Matrix

| Role | Request Elevation | Approve / Deny Queue | Audit Ledger & CSV | Manage Users & Policies |
| :--- | :--- | :--- | :--- | :--- |
| **ADMIN** | Allowed (All Spaces) | Allowed (Independent Peer) | Full Read & Export | Full Read / Write |
| **APPROVER** | Allowed (Assigned Spaces) | Allowed (Assigned Spaces) | Own Session History | Denied |
| **REQUESTER** | Allowed (Assigned Spaces) | Denied | Own Session History | Denied |
| **AUDITOR** | Denied | Denied | Full Read & Export | Denied |

---

## REST & Real-Time API Surface

| Endpoint | Method | Role Guard | Description |
| :--- | :--- | :--- | :--- |
| `/healthz` | `GET` | Public Probe | Container liveness & readiness probe (`200 OK`). |
| `/api/events` | `GET` | Authenticated | Server-Sent Events (SSE) stream for real-time state updates. |
| `/api/requests` | `GET` / `POST` | Auth / `REQUESTER+` | List scoped leases or submit standard / break-glass requests. |
| `/api/requests/:id/approve` | `POST` | `APPROVER`, `ADMIN` | Record peer approval (enforces self-approval block & 2-peer quorum). |
| `/api/requests/:id/deny` | `POST` | `APPROVER`, `ADMIN` | Reject pending request with optional audit review note. |
| `/api/requests/:id/extend` | `POST` | Owner, `ADMIN` | Extend active non-break-glass lease by `+30m` (max 2x). |
| `/api/requests/:id/revoke` | `POST` | Owner, `APPROVER+` | Strip directory membership immediately ahead of TTL expiry. |
| `/api/internal/cron/expire` | `POST` | `X-Cron-Secret` / `ADMIN` | Cloud Scheduler trigger for deterministic multi-instance expiry. |
| `/api/logs/export` | `GET` | `ADMIN`, `AUDITOR` | Download formula-sanitized RFC-4180 compliance audit CSV. |
