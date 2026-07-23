# GWS JIT Access Portal: User Manual & Configuration Reference

This reference manual provides a granular breakdown of the configurations, architecture options, user roles, and access controls within the Google Workspace (GWS) Just-In-Time (JIT) Access Portal.

---

## 1. Access Command Center & JIT Requests

The **Command Center** serves as the primary end-user dashboard for requesting time-bound group elevations and monitoring request states.

*   **Active Space Selection:** Sets the tenant context (e.g., Global vs. Specific Child Tenant). Filtering by Space dynamically restricts visible JIT groups and logs.
*   **Select JIT Group:** The target Google Group for temporary membership. Only groups tied to an active JIT policy within the selected Space are visible.
*   **Duration:** The TTL (Time-To-Live) for group membership. Upon expiration, a background worker automatically revokes directory access.
*   **Justification:** A mandatory text entry specifying the business or technical reason for elevation. This is permanently written to the immutable audit trail.

---

## 2. Portal Settings — System Configuration

> ⚠️ **Access Control:** This section is restricted exclusively to identities holding the `ADMIN` role.

### Core Settings
*   **Engine Mode:**
    *   `MOCK`: Simulates Google Directory API operations in-memory. Recommended for local sandboxing and testing policy logic.
    *   `LIVE`: Executes real-time `Directory.Members.insert()` and `delete()` operations against the live production Google Workspace directory.
*   **Workspace Domain:** The primary managed G Suite/Google Workspace domain (e.g., `company.com`).
*   **Delegated Operator Email:** A standard Google Workspace account (non-Super-Admin recommended) granted explicit group management privileges. The underlying GCP Service Account impersonates this user via **Domain-Wide Delegation (DWD)**.
*   **Access Review Attestation Interval (Days):** The sliding compliance window (Default: `90` days) before a group configuration triggers a mandatory administrative re-certification.

### Integration & Alerts
*   **Global Webhook Notification URL:** The fallback webhook destination (Slack, Microsoft Teams, or Google Chat). The portal dispatches structured JSON payloads capturing lifecycle state transitions: `PENDING` $\rightarrow$ `APPROVED` / `DENIED` $\rightarrow$ `REVOKED` / `EXPIRED`.
*   **Test Webhook Button:** Fires a synthetic payload to validate endpoint end-to-end network connectivity and schema parsing.

### Identity & Credentials Architecture
*   **Workload Identity Federation (Keyless - Recommended):** Bypasses static JSON key hazards. The JIT Portal exchanges its ambient runtime GCP identity (e.g., GKE or Compute Engine) for short-lived delegation tokens.
    *   *Requirement:* **Workspace Delegation Service Account Email**
*   **Service Account JSON / WIF Config:** Legacy cryptographic authentication. Requires pasting the raw, unencrypted contents of a GCP Service Account private key file.

---

## 3. Portal Settings — Global Policies

Global Policies define the baseline Attribute-Based Access Control (ABAC) rules for the root Workspace domain.

*   **Group JIT Policy List:** An inventory of Google Groups synced automatically via the Directory API or registered through manual overrides.
*   **⚡ Pre-Approved Option:** Bypasses manual `APPROVER` intervention. When enabled, requests to join this group are automatically validated against ABAC tags and instantly provisioned.
*   **Required Attribute Tags:** Key-value markers a requester's profile must feature to qualify for elevation (e.g., `team: devops`).
*   **Manual Add Group:** Allows admins to force-register arbitrary target group emails, bypassing the broader Directory API sync loop.

---

## 4. Portal Settings — Spaces (Multi-Tenancy)

Spaces offer structural isolation tailored for Managed Service Providers (MSPs) and large enterprises requiring distinct boundary lines for child domains, specific policies, and logging pipelines.

| Configuration Field | Technical Purpose |
| :--- | :--- |
| **Space Name** | Logical unique identifier for the specific tenant environment. |
| **Space Domain** | The specific isolated Workspace domain bound to this Space. |
| **Delegated Operator Email** | Tenant-specific administrator account used for DWD impersonation. |
| **Space Webhook URL** | Dedicated notification routing for tenant-isolated Slack/Teams channels. |
| **Credentials JSON Override** | Optional isolated GCP Service Account key text field. If unconfigured, the Space defaults to the global system credentials. |

---

## 5. Access Reviews & Compliance Attestation

To maintain SOC2 Type II and ISO 27001 readiness, JIT policies undergo recurring verification to prevent access drift.

*   **JIT Policy Listing:** A central registry displaying active policies, historical attestation timestamps, and the identity of the certifying administrator.
*   **Certify Button:** Triggers an automated multi-step compliance reconciliation audit:
    1. Resets the policy expiration clock by the configured Attestation Interval.
    2. Queries the live Google Workspace Directory API for actual current group membership.
    3. Cross-references real-time membership against the active requests database.
    4. **Drift Identification:** Flags **orphaned access** (members added directly via admin console out-of-band) and alerts security teams via webhooks.

---

## 6. IAM Roles & Attribute-Based Access Control (ABAC)

### Platform Roles

| Role Badge | Privileges | Scope |
| :--- | :--- | :--- |
| `[ ADMIN ]` | Full Read/Write, System Mutation, User Management, Request, Approve | Global / All Spaces |
| `[ APPROVER ]` | Read-only to configurations; Can approve/deny pending request queues | Assigned Spaces |
| `[ REQUESTER ]` | Read-only to self dashboard; Can initiate elevation requests | Assigned Spaces |
| `[ AUDITOR ]` | Read-only access to system logs, policies, and the Security Audit Trail | Global / All Spaces |

### ABAC Engine Construction
*   **Eligible Attributes:** System-wide schema keys declared globally within *System Config* (e.g., `oncall`, `clearance_level`, `region`).
*   **User Attribute Assignment:** Administrators map specific attribute values to user records. For a user to successfully request a JIT group, their assigned profile attributes must **completely satisfy** the criteria configured on the target group's JIT policy.
