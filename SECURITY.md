# Security Policy & Threat Model

## Supported Versions

Only the latest release of the JIT Access Portal is actively supported with security updates. We recommend always running the latest tagged version.

| Version | Supported          |
| ------- | ------------------ |
| v1.x    | :white_check_mark: |
| < v1.0  | :x:                |

---

## Threat Model (STRIDE Framework)

The Google Workspace JIT Access Portal undergoes continuous security evaluation against the **STRIDE** framework and **OWASP Top 10** standards.

| Threat Category | Potential Risk Vector | Built-in Mitigation & Architectural Control |
| :--- | :--- | :--- |
| **Spoofing (S)** | Unauthorized users masquerading as valid Requesters or Approvers. | **IAP / SSO Integration:** In production, identity is verified via Google Cloud Identity-Aware Proxy (`x-goog-iap-jwt-assertion` cryptographic JWT signature verification). Password hashes use high-iteration PBKDF2 (`v2`, 210,000 iterations). |
| **Tampering (T)** | Altering request payloads or modifying out-of-band group memberships directly in Google Admin Console. | **Attestation & Access Reviews:** Backend routinely queries Google Directory API live state. Uncertified memberships are flagged as "Orphaned Access", logging audit events and triggering instant webhook security alerts. |
| **Repudiation (R)** | Users denying role elevations or approvals performed by their accounts. | **Central Security Audit Trail:** Every action (request creation, peer approval, rejection, activation, and expiration) generates an immutable structured audit log with full actor email, timestamp, and space metadata. |
| **Information Disclosure (I)** | Exposing service account keys or cross-tenant space details. | **Keyless WIF & Redaction:** Supports Workload Identity Federation (eliminating static JSON keys). Non-admin roles calling `/api/spaces` get sanitized responses with sensitive credentials omitted. |
| **Denial of Service (D)** | Brute-forcing authentication endpoints or flooding JIT request creation queues. | **Rate Limiting Middleware:** `express-rate-limit` throttles login attempts (`/api/auth/login`) to 15 requests/15m and API request creation (`/api/requests`) to 100 requests/15m per IP. |
| **Elevation of Privilege (E)** | Self-approval by requesters or unauthorized space-hopping. | **Dual-Custody & ABAC Enforcement:** Requesters are strictly prohibited from approving their own requests. Submissions check assigned space bounds and evaluate dynamic ABAC profile tag intersections. |

---
