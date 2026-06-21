# Implementation Plan - MSP Multi-Tenant Spaces, Settings Redesign, Refresh Button, & Webhook/Email Notifications

This plan outlines the design and implementation details to support space-based multi-tenant configurations in the GWS JIT Access Portal. This enables Managed Service Providers (MSPs) and large enterprise organizations to define tenant spaces with separate domains, delegate admin emails, and custom Google APIs credentials alongside the global system configuration. We will also redesign the Portal Settings UI tab to significantly improve readability, add a manual data Refresh button, and implement Webhook/Email notifications.

---

## Proposed Changes

We will modify files inside `/home/thecloudlynomad/Linux-Projects-Code/jit-workspace-pulse` in WSL (mirrored from our Windows workspace):

### 1. Types Configuration

#### [MODIFY] [backend/src/types.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/backend/src/types.ts) & [frontend/src/types.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/frontend/src/types.ts)
* Define the `SpaceConfig` interface:
  ```typescript
  export interface SpaceConfig {
    id: string;
    name: string;
    domain: string;
    adminEmail: string;
    serviceAccountJson?: string; // Optional (falls back to global if empty)
    autoApproval: boolean;
    groupPolicies?: GroupJitPolicy[];
    notificationType: 'NONE' | 'WEBHOOK' | 'EMAIL' | 'BOTH';
    webhookUrl?: string;
    notificationEmail?: string;
  }
  ```
* Update `AppConfig` to include the notification fields:
  ```typescript
  export interface AppConfig {
    mode: 'MOCK' | 'LIVE';
    domain: string;
    serviceAccountJson?: string;
    adminEmail?: string;
    autoApproval: boolean;
    groupPolicies?: GroupJitPolicy[];
    eligibleGroupEmails?: string[]; // Kept for backward compatibility migrations
    spaces?: SpaceConfig[]; // Multi-tenant space-based configurations
    notificationType: 'NONE' | 'WEBHOOK' | 'EMAIL' | 'BOTH';
    webhookUrl?: string;
    notificationEmail?: string;
  }
  ```

---

### 2. Database Tier

#### [MODIFY] [backend/src/db.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/backend/src/db.ts)
* Add CRUD helper functions:
  * `getSpaces()`: Retrieves the list of space configurations. If `DATABASE_ENGINE === 'FIRESTORE'`, it queries the `spaces` collection. If `JSON`, it reads from `db.config.spaces` (initializing as an empty array if missing).
  * `saveSpace(space)`: Saves or updates a space config.
  * `deleteSpace(id)`: Deletes a space config.
* Update `initDb()` default DB object to seed notification fields (`notificationType: 'NONE'`) in both JSON and Firestore schemas.

---

### 3. Google Workspace Routing

#### [MODIFY] [backend/src/google.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/backend/src/google.ts)
* Refactor `getAdminClient()` into a generalized `getAdminClientForConfig(serviceAccountJson, adminEmail)` function.
* Generalize `listGroups()`, `addGroupMember()`, and `removeGroupMember()` to route requests:
  * Check the domain name of the target group email (e.g. `@company-a.com`).
  * If a matching Space is found in the database, utilize that Space's specific `adminEmail` and `serviceAccountJson` (falling back to the global service account if the space has none configured).
  * If no matching space domain is found, fall back to the global credentials.
* Update `listGroups()` to query both global and space-specific Google directories, merge the results, and deduplicate by group email. In `MOCK` mode, dynamically generate mock group entries for configured spaces so they can be tested immediately in the UI.

---

### 4. Notifications Engine

#### [NEW] [backend/src/notifications.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/backend/src/notifications.ts)
* Create a lightweight notification dispatcher:
  * Looks up the space config matching the group email domain (falling back to global config if unmatched).
  * If the resolved notification type is `WEBHOOK` or `BOTH` and `webhookUrl` is configured:
    * Sends a JSON HTTP POST request with a formatted Slack/Teams/Google Chat markdown payload using Node's built-in `fetch` API.
  * If the resolved notification type is `EMAIL` or `BOTH` and `notificationEmail` is configured:
    * Logs the email sending event (`[NOTIFICATION] Sending email to...`) and provides a code placeholder for production SMTP/SendGrid clients.

---

### 5. Backend Endpoints & Policy Verification

#### [MODIFY] [backend/src/index.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/backend/src/index.ts) & [backend/src/scheduler.ts](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/backend/src/scheduler.ts)
* Implement a helper function `resolveSpaceSettings(groupEmail)` that returns the active `autoApproval` flag, policy rules, and space name.
* Update request creation, approval, and rejection endpoints to:
  * Use the resolved settings (verifying eligibility rules and auto-approval).
  * Dispatch notifications when a request is:
    * **Created:** `[JIT Request PENDING] bob@company.com requested Super Admin access.` (Alerts Approvers).
    * **Approved:** `[JIT Request APPROVED] bob@company.com JIT access has been activated.` (Alerts Requester/Auditors).
    * **Denied:** `[JIT Request DENIED] bob@company.com request was rejected.` (Alerts Requester).
* Update `scheduler.ts` and the manual revoke endpoint to trigger notifications when access is:
    * **Expired/Revoked:** `[JIT Request REVOKED/EXPIRED] bob@company.com access has been terminated.` (Alerts Requester/Auditors).
* Add CRUD endpoints for spaces:
  * `GET /api/spaces` - Fetch all spaces.
  * `POST /api/spaces` - Create a space.
  * `PUT /api/spaces/:id` - Update a space.
  * `DELETE /api/spaces/:id` - Delete a space.
  * *Note: All space endpoints will require `ADMIN` authorization.*

---

### 6. Frontend Settings Redesign & Spaces Interface

#### [MODIFY] [frontend/src/components/Settings.tsx](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/frontend/src/components/Settings.tsx)
* **Readability Redesign:**
  * Reorganize Settings into distinct tabbed sub-views:
    1. **System Config:** Live/Mock mode, Global Domain, Global Admin Email, Global SA JSON, and Global Auto-Approval.
    2. **Global JIT Policies:** Manage policy rules for the global tenant.
    3. **Spaces (Multi-Tenant):** Management of spaces. Add, edit, delete spaces, and design per-space JIT policies.
  * **Notifications Panel:** Add a card inside Global Settings and Space Settings to configure:
    * Notification Type dropdown (`NONE`, `WEBHOOK`, `EMAIL`, `BOTH`).
    * Webhook URL input field.
    * Notification Email input field.
  * Replace the single huge scrollable form with glassmorphic cards, descriptive sub-headers, clear tooltips, and highlighted warning alert elements.

---

### 7. Manual Data Refresh Button

#### [MODIFY] [frontend/src/App.tsx](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/frontend/src/App.tsx) & [frontend/src/components/UserManagement.tsx](file:///C:/Users/damia/.gemini/antigravity/worktrees/jit-workspace-pulse/jit-google-workspace-solution/frontend/src/components/UserManagement.tsx)
* **Refresh Button Implementation:**
  * Import `RefreshCw` from `lucide-react` in `App.tsx`.
  * Add a `refreshTrigger` state (`number`) in `App.tsx` and pass it down to child components.
  * Implement `handleManualRefresh()` in `App.tsx` which:
    1. Triggers CSS spin animation on the refresh icon.
    2. Sequentially awaits `fetchRequests()`, `fetchConfig()`, and increments the `refreshTrigger` to reload user accounts.
  * Add the Refresh button in the `viewport-header` next to settings.
  * In `UserManagement.tsx`, add `refreshTrigger` to the `useEffect` dependency array to automatically refresh the user list when the global refresh button is clicked.

---

## Verification Plan

### Automated Verification
* Verify clean compilation: `npm run build` in WSL.
* Verify Docker container build: `docker build -t gws-jit-portal .`.

### Manual Verification
1. Access the updated **Settings** tab as `superadmin@company.com`.
2. Confirm settings is highly readable, divided into clear panels.
3. Configure a Slack/Discord webhook URL in Settings under **Global Config** (set to `BOTH` or `WEBHOOK`).
4. Submit a JIT request and verify the webhook POST payload is sent and appears in the target Slack/Discord channel.
5. Create a Space (Tenant A) with auto-approval enabled and its own webhook URL.
6. Submit a request for a Tenant A group, verify it is auto-approved and that the activation webhook triggers using Tenant A's webhook URL.
