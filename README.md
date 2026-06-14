# Just-In-Time (JIT) Admin Access for Google Workspace

**Author:** Damian Sztankowski (GDE for Google Cloud | Google Cloud Ambassador)

Google Workspace lacks native Just-In-Time (JIT) role elevation. This solution bridges that gap, allowing organizations to implement the principle of least privilege for Google Workspace administrative roles.

Instead of keeping permanent standing privileges (such as standing "Super Admin" roles), administrators have normal accounts and request temporary, time-bound privilege elevations which are automatically revoked.

---

## Table of Contents
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [How to Run Locally](#how-to-run-locally)
- [Enterprise Google Cloud Deployment Guide](#enterprise-google-cloud-deployment-guide)
- [Live Google Workspace Integration](#live-google-workspace-integration)
- [Role-Based Access Control (RBAC) & Base Privileges](#role-based-access-control-rbac--base-privileges)
- [In-App Documentation Viewer](#in-app-documentation-viewer)
- [Multi-Tenant Spaces & Delegated Operator Spaces](#multi-tenant-spaces--delegated-operator-spaces)
- [Webhook Notifications](#webhook-notifications)
- [Access Reviews & Policy Attestation](#access-reviews--policy-attestation)
- [Manual Data Refresh](#manual-data-refresh)

---

## Key Features

- **Self-Service Requests:** Choose a role (Super Admin, User Admin, etc.), justify the business need, and select activation durations (e.g. 30m, 1h, 2h).
- **Dual-Custody Approvals:** Enforce peer approvals. Requesters cannot approve their own requests.
- **Auto-Revocation Engine:** A background scheduler automatically polls active sessions and revokes Workspace privileges immediately upon expiration.
- **Enterprise-Ready Architecture:** Suppress local credentials screens and run secure corporate Single Sign-On (SSO) using Google Cloud Identity-Aware Proxy (IAP).
- **Multi-Storage Support:** Switch seamlessly between a local JSON file database (dev) and a fully managed Google Cloud Firestore database (production).
- **Central Security Audit Trail:** Clear logging of every JIT request, approval, rejection, activation, and expiration.
- **Ready for Google Workspace Admin SDK:** Live mode executes actual directory membership changes using a GCP Service Account with Domain-Wide Delegation.

---

## Tech Stack

- **Frontend:** React, Vite, TypeScript, Vanilla CSS (Glassmorphism Dark Theme, Outfit/Inter typography, Lucide Icons)
- **Backend:** Node.js, Express, TypeScript, Google APIs Client (`googleapis`, `@google-cloud/firestore`, `google-auth-library`)
- **Containerization:** Multi-stage Docker packaging (React build, TS compilation, and minimal runner)
- **Local Dev Engine:** `tsx` watch, `concurrently` for running dev servers

---

## How to Run Locally

### 1. Start Frontend and Backend Concurrently
Run the following command in the workspace root directory:
```bash
npm run dev
```

This starts:
- The Express Backend on [http://localhost:3001](http://localhost:3001)
- The Vite Frontend on [http://localhost:3000](http://localhost:3000)

### 2. Access the Portal
Open your browser and navigate to **[http://localhost:3000](http://localhost:3000)**.

> [!WARNING]
> **Default Admin Credentials:** The portal seeds a single default administrative user:
> * **Email:** `superadmin@company.com`
> * **Password:** `password`
>
> You must log in and change this password immediately under the **User Management** tab when deploying the application.

---

## Enterprise Google Cloud Deployment Guide

This guide walks you through deploying the GWS JIT Access Portal to Google Cloud using **Cloud Run**, **Firestore**, and **Identity-Aware Proxy (IAP)**.

### Architecture Overview

```
+----------------------------------------------------------------------------------------------------+
|                                      PORTAL ARCHITECTURE & DATA FLOW                                |
+----------------------------------------------------------------------------------------------------+

  [ Requesters / Admins ]        [ Approvers / Auditors ]
             |                              |
             +---------------+--------------+
                             |
                             v
               +---------------------------+
               |  HTTPS External ALB       |
               |  (Google Cloud L7 LB)     |
               +---------------------------+
                             |
                             |  [ Enforces Identity-Aware Proxy (IAP) ]
                             v
               +---------------------------+
               |      Google Cloud         |
               |  Identity-Aware Proxy     | <--- Authenticates via Workspace/GCP Identity
               +---------------------------+
                             |
                             |  [ Signed JWT Header (x-goog-iap-jwt-assertion) ]
                             v
+----------------------------+-----------------------------------------------------------------------+
|  CLOUD RUN RUNTIME BOUNDARY                                                                        |
|                                                                                                    |
|    +----------------------------+             +----------------------------------+                 |
|    |    Vite React Frontend     |             |      Express REST API            |                 |
|    |    (Single Page App)       | <---------> |      (Node.js Server)            |                 |
|    +----------------------------+             +----------------------------------+                 |
+---------------------------------------------------------------|------------------|-----------------+
                                                                |                  |
                       [ Reads & Writes Policy/Request State ]  |                  | [ exchanges JWT for access token ]
                                                                v                  v
                                                 +----------------------+  +-----------------------+
                                                 | Google Cloud         |  | Google Cloud          |
                                                 | Firestore Database   |  | IAM Credentials API   |
                                                 +----------------------+  +-----------------------+
                                                                                       |
                                                                                       | [ Delegate Access Token ]
                                                                                       v
                                                                           +-----------------------+
                                                                           | Google Workspace      |
                                                                           | Admin SDK (Directory) |
                                                                           +-----------------------+
                                                                                       |
                                                                                       | [ Provisions JIT Group Membership ]
                                                                                       v
                                                                           +-----------------------+
                                                                           | Target Workspace      |
                                                                           | Directory Group       |
                                                                           +-----------------------+
                                                                                       |
                                                                                       | [ Dispatches JSON Alerts ]
                                                                                       v
                                                                           +-----------------------+
                                                                           | Slack / Teams Webhook |
                                                                           +-----------------------+
```

---

### Step 1: Initialize gcloud & Enable APIs
Ensure your `gcloud` CLI is configured for your target project and region:
```bash
# Set your active project
gcloud config set project YOUR_PROJECT_ID

# Set default deployment region
gcloud config set run/region us-central1
```

Enable the required Google Cloud service APIs:
```bash
gcloud services enable \
    run.googleapis.com \
    firestore.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    iap.googleapis.com \
    compute.googleapis.com
```

---

### Step 2: Set Up Google Cloud Firestore
1. In the Google Cloud Console, navigate to **Firestore**.
2. Click **Create Database**.
3. Select **Firestore in Native Mode** (Required by our Firestore database driver).
4. Choose your database location and click **Create Database**.

*Note: The database collections (`users`, `requests`, `logs`, `config`) will automatically initialize and seed default administrative credentials and policies on the first application launch.*

---

### Step 3: Containerize and Build the Application
We use a multi-stage Docker build to package both the React static assets and the Express Node server.

1. **Create an Artifact Registry Repository** to store the Docker container image:
   ```bash
   gcloud artifacts repositories create gws-jit-repo \
       --repository-format=docker \
       --location=us-central1 \
       --description="GWS JIT Access Portal Docker Repository"
   ```

2. **Build and push the image** using Google Cloud Build:
   ```bash
   gcloud builds submit --tag us-central1-docker.pkg.dev/YOUR_PROJECT_ID/gws-jit-repo/gws-jit-portal:latest .
   ```

---

### Step 4: Deploy the Cloud Run Service
Deploy the container to Cloud Run. Because authentication will be handled by Identity-Aware Proxy (IAP) at the Load Balancer level, we set the service to public (`--allow-unauthenticated`) and configure the database engine.

```bash
gcloud run deploy gws-jit-portal \
    --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/gws-jit-repo/gws-jit-portal:latest \
    --platform=managed \
    --region=us-central1 \
    --allow-unauthenticated \
    --set-env-vars="DATABASE_ENGINE=FIRESTORE,AUTH_MODE=IAP"
```

#### Grant Firestore Permissions to the Cloud Run Service
Retrieve the Service Account email assigned to your Cloud Run service (by default, it uses the Compute Engine default service account). Grant it the **Cloud Datastore User** role to allow Firestore reads/writes:
```bash
# Grant Firestore access to the Cloud Run service account
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:YOUR_RUN_SERVICE_ACCOUNT@developer.gserviceaccount.com" \
    --role="roles/datastore.user"
```

---

### Step 5: Configure the Global Application Load Balancer
Identity-Aware Proxy (IAP) cannot be enabled directly on a Cloud Run service. You must route traffic through a Google Cloud HTTPS Load Balancer.

1. **Create a Serverless Network Endpoint Group (NEG)** pointing to the Cloud Run service:
   ```bash
   gcloud compute network-endpoint-groups create gws-jit-serverless-neg \
       --region=us-central1 \
       --network-endpoint-type=serverless \
       --cloud-run-service=gws-jit-portal
   ```

2. **Create a Global Backend Service:**
   ```bash
   gcloud compute backend-services create gws-jit-backend-service \
       --global \
       --load-balancing-scheme=EXTERNAL_MANAGED
   ```

3. **Add the Serverless NEG as a backend** to the Backend Service:
   ```bash
   gcloud compute backend-services add-backend gws-jit-backend-service \
       --global \
       --network-endpoint-group=gws-jit-serverless-neg \
       --network-endpoint-group-region=us-central1
   ```

4. **Create a URL Map** (the Load Balancer router) and set the backend service as the default route:
   ```bash
   gcloud compute url-maps create gws-jit-url-map \
       --default-service=gws-jit-backend-service
   ```

5. **Create a Google-managed SSL Certificate** (replace with your custom domain name):
   ```bash
   gcloud compute ssl-certificates create gws-jit-ssl-cert \
       --domains="jit.yourcompany.com" \
       --global
   ```
   *Note: Ensure your domain's DNS A-record points to the Load Balancer IP address once created.*

6. **Create a Target HTTPS Proxy:**
   ```bash
   gcloud compute target-https-proxies create gws-jit-https-proxy \
       --url-map=gws-jit-url-map \
       --ssl-certificates=gws-jit-ssl-cert
   ```

7. **Reserve a Global Static IP Address:**
   ```bash
   gcloud compute addresses create gws-jit-ip \
       --ip-version=IPV4 \
       --global
   ```
   To see your reserved static IP:
   ```bash
   gcloud compute addresses describe gws-jit-ip --global --format="value(address)"
   ```

8. **Create a Global Forwarding Rule** (Frontend) to route incoming HTTPS traffic on port 443:
   ```bash
   gcloud compute forwarding-rules create gws-jit-forwarding-rule \
       --address=gws-jit-ip \
       --target-https-proxy=gws-jit-https-proxy \
       --global \
       --ports=443
   ```

---

### Step 6: Enable and Configure Identity-Aware Proxy (IAP)

1. **Configure the OAuth Consent Screen:**
   * In the Google Cloud Console, navigate to **APIs & Services** > **OAuth consent screen**.
   * Choose User Type **Internal** (limiting portal login eligibility strictly to your Google Workspace directory users).
   * Fill out the App Name, support email, and developer email, and click **Save**.

2. **Enable IAP on the Backend Service:**
   * Go to **Security** > **Identity-Aware Proxy** in the Console.
   * Locate the `gws-jit-backend-service` under the **HTTPS Resources** list.
   * Toggle the **IAP** slider to **Enabled**.

3. **Grant Access to Authorized Users:**
   * Select the check box for the `gws-jit-backend-service`.
   * In the right-hand panel, click **Add Principal**.
   * Add the specific corporate emails or Google Groups you want to grant login access to.
   * Assign them the **IAP-secured Web App User** (`roles/iap.httpsResourceAccessor`) role.

4. **Retrieve the IAP Audience Path:**
   * Locate your Backend Service in the IAP Console page, click the three vertical dots on the right, and select **Show JWT Audience**.
   * Copy the Audience string (format: `/projects/PROJECT_NUMBER/global/backendServices/BACKEND_SERVICE_ID`).

5. **Update Cloud Run Configuration & Restrict Ingress:**
   Configure the portal with your `IAP_AUDIENCE` and restrict direct ingress traffic. This forces all user traffic to pass through the Load Balancer (preventing anyone from bypassing IAP authentication by accessing the direct `*.run.app` URL):
   ```bash
   gcloud run services update gws-jit-portal \
       --region=us-central1 \
       --set-env-vars="DATABASE_ENGINE=FIRESTORE,AUTH_MODE=IAP,IAP_AUDIENCE=/projects/YOUR_PROJECT_NUMBER/global/backendServices/YOUR_BACKEND_SERVICE_ID" \
       --ingress=internal-and-cloud-load-balancing
   ```

---

## Live Google Workspace Integration

To connect the portal to your actual Google Workspace instance to execute live directory group assignments:

### 1. Choose Authentication Method
You can authenticate the JIT Access Portal to Google Cloud using one of two methods:
* **Option A: GCP Native Workload Identity (Keyless - Recommended)**: Since the portal runs on Google Cloud (e.g., Cloud Run or GKE), it uses the container's ambient identity to sign JWT assertions remotely via the Google Cloud IAM Credentials API. **No private keys are stored.**
* **Option B: Service Account JSON Keys / External WIF Config**: Traditional method using a downloaded JSON key file or external Workload Identity Federation configuration file (`external_account`) pasted directly in settings.

---

### 2. Configure GCP Native Workload Identity (Option A - Keyless)

To set up keyless Domain-Wide Delegation using native Workload Identity on Google Cloud (Cloud Run / GKE), follow these steps:

#### Step 2.1: Identify the Service Accounts
1. **Portal Running Service Account**: The identity under which the JIT Portal container runs in GCP (e.g., the Cloud Run runtime service account: `gws-jit-portal@your-project.iam.gserviceaccount.com`).
2. **Workspace Delegation Service Account**: The service account authorized for DWD in Google Workspace (e.g., `workspace-dwd-sa@your-project.iam.gserviceaccount.com`). 
   * *Note:* You can also use a single service account for both.

#### Step 2.2: Grant Token Creator Permissions in GCP IAM
1. Go to the **GCP Console > IAM & Admin > Service Accounts**.
2. Select the **Workspace Delegation Service Account** (`workspace-dwd-sa@...`).
3. Click the **Permissions** tab at the top.
4. Click **Grant Access** and configure:
   * **New principals**: The email of the **Portal Running Service Account** (`gws-jit-portal@...`).
   * **Role**: **Service Account Token Creator** (`roles/iam.serviceAccountTokenCreator`).
5. Save the configuration. This allows the JIT Portal to call the IAM API to sign DWD assertions remotely.

#### Step 2.3: Enable the IAM Credentials API
1. In the GCP Console, search for **IAM Service Account Credentials API** (`iamcredentials.googleapis.com`).
2. Select it and click **Enable**.

---

### 3. Configure Domain-Wide Delegation (DWD)
Workspace APIs require a service account to impersonate an operator to assign and remove users from directory groups:
1. Go to the [Google Workspace Admin Console](https://admin.google.com/).
2. Navigate to **Security** > **Access and data control** > **API controls**.
3. Under **Domain-wide delegation**, click **Manage Domain Wide Delegation**.
4. Click **Add new**.
5. In the **Client ID** field, enter the Unique numeric Client ID of your **Workspace Delegation Service Account**.
6. In **OAuth Scopes**, enter:
   `https://www.googleapis.com/auth/admin.directory.group`
7. Click **Authorize**.

---

### 4. Secure Operator Delegation Setup (Highly Recommended)
By default, the Workspace API client configuration allows the service account to impersonate *any* user in your domain. To prevent directory-wide superadmin privilege abuse, configure a **Custom Admin Role** with minimal permissions to delegate to the service account:
1. In the [Google Workspace Admin Console](https://admin.google.com/), navigate to **Account** > **Admin Roles**.
2. Click **Create new role**.
3. Provide a name and description (e.g., `JIT Group Member Operator`).
4. Select the following minimal privileges:
   - **Admin console privileges** > **Groups** > **Read** (Allows reading group details)
   - **Admin console privileges** > **Groups** > **Update** (Allows adding/removing members from groups)
   - **Admin console privileges** > **Users** > **Read** (Allows reading user accounts)
5. Click **Save** and then click **Assign Role**.
6. Assign this role to a standard user account dedicated to this task (e.g., `operator@company.com`). Do **NOT** assign Super Admin privileges to this user.
7. Use this standard user email as the **Delegated Operator Email** when configuring the JIT Portal. This limits the service account's blast radius to group membership management only.

---

### 5. Save Settings in JIT Portal
1. Open your browser and log in to your JIT Portal via your Load Balancer domain.
2. Go to the **Settings** tab (only accessible to users with the **ADMIN** role).
3. Toggle the Mode to **LIVE**.
4. Enter your **Workspace Domain** (e.g., `company.com`).
5. Enter the **Delegated Operator Email** configured in Step 4 (e.g., `operator@company.com`).
6. Configure the authentication parameters:
   * **For WIF (Ambient / GCP Native)**: Select **Workload Identity Federation (Keyless)** and enter the **Workspace Delegation Service Account Email**.
   * **For WIF (External account JSON) or SA keys**: Select **Service Account JSON / WIF Config** and paste the JSON configuration file content.
7. Click **Save Global System Settings**.

---

## Role-Based Access Control (RBAC) & Base Privileges

The portal enforces strict Role-Based Access Control both in the frontend UI and on all backend REST API endpoints. The system supports four roles:

1. **ADMIN**: 
   - **Base Privileges**: JIT Requesting (`Allowed`), Peer Approval (`Allowed`), User Management (`Allowed`), Security Auditing (`Allowed`), Portal Settings (`Allowed`).
   - **UI Views**: Access to all panels: Command Center (with request form), User Accounts tab, and Portal Settings modal. Can view and modify all tenant Spaces.
2. **APPROVER**:
   - **Base Privileges**: Peer Approval (`Allowed`), JIT Requesting (`Disabled`), User Management (`Disabled`), Security Auditing (`Disabled`), Portal Settings (`Disabled`).
   - **UI Views**: View of active and pending requests across all spaces (unfiltered by selected space, excluding self-requests). The JIT request form panel is hidden, and the dashboard automatically scales to full-width.
3. **REQUESTER**:
   - **Base Privileges**: JIT Requesting (`Allowed`), Peer Approval (`Disabled`), User Management (`Disabled`), Security Auditing (`Disabled`), Portal Settings (`Disabled`).
   - **UI Views**: View of the JIT request form panel, and a dashboard showing only their own active, pending, and historical requests.
4. **AUDITOR**:
   - **Base Privileges**: Security Auditing (`Allowed`), JIT Requesting (`Disabled`), Peer Approval (`Disabled`), User Management (`Disabled`), Portal Settings (`Disabled`).
   - **UI Views**: Access to the Central Security Audit Trail tab. The JIT request form panel is hidden, and the dashboard scales to full-width.

*Note: The **Base Privileges** card in the left sidebar updates dynamically to show the specific allowed and disabled capabilities for the currently logged-in user.*

---

## In-App Documentation Viewer

A dedicated **Documentation** tab (using the `BookOpen` icon) is accessible to all logged-in users in the left sidebar. This pulls this setup guide directly from the backend, parsing and rendering it using a custom-built markdown engine styled to match the dark glassmorphic design system.

---

## Multi-Tenant Spaces & Delegated Operator Spaces

The GWS JIT Portal supports multi-tenant space-based configurations. This allows Managed Service Providers (MSPs) and large enterprises to isolate separate Workspace domains, group policies, operator credentials, and notifications under different "Spaces".

### 1. Space Isolation & Routing
- Each Space defines its own **Workspace Domain**, **Delegated Operator Email**, JIT group policies, and notification channels.
- Spaces can optionally specify their own **Service Account JSON** private key override. If left blank, the Space falls back to using the global service account credentials.
- When a user requests membership in a group (e.g., `admins@tenant-a.com`), the backend automatically matches the group's domain or explicitly configured policy mapping, resolves the target Space, and routes the API calls using that Space's specific credentials and delegated operator email.

### 2. User & Space Assignments
- Admins can assign users to one or more Spaces under the **User Management** tab.
- Edit a user, and check the boxes under **Assigned Spaces** to map them.

### 3. Space Switching UI
- Users who are assigned to multiple Spaces will see a **Space Switcher** dropdown in the left sidebar.
- Selecting a different Space automatically filters the **Dashboard** and **JIT Request** panels to show only the groups, policies, and active/pending requests associated with that Space.
- Global Admins are automatically granted access to all Spaces and can switch between them at any time.

---

## Webhook Notifications

You can configure incoming webhooks to alert admins/approvers of pending requests, and users of activation/expiration events. The portal supports Slack, Microsoft Teams, Google Chat, or any other service that accepts Markdown/text-based JSON payloads.

### 1. Hierarchy Configuration
- **Global Level**: Configure the fallback webhook URL on the **Settings > System Config** tab under **Global Webhook Notification URL**.
- **Space Level**: Configure an optional webhook URL under **Settings > Spaces > Edit Space > Space Webhook URL** to isolate tenant-specific alerts (e.g., routing Tenant A alerts to Tenant A's Slack channel, while falling back to the global webhook for others).

### 2. Trigger Events
- **PENDING**: Fired when a JIT request is submitted.
- **APPROVED**: Fired when an approver grants JIT access.
- **DENIED**: Fired when an approver rejects a request.
- **REVOKED/EXPIRED**: Fired when access is early-revoked or automatically terminated by the scheduler.

---

## Access Reviews & Policy Attestation

To satisfy enterprise security compliance requirements (such as SOC2, ISO 27001), the GWS JIT Portal supports periodic attestation/recertification of JIT policies.

### 1. Attestation Policy Configuration
- In **Settings > System Config**, set the **Access Review Attestation Interval (Days)** (e.g. 90 days).
- Every group policy keeps track of its last certified timestamp and next due date.
- If a group policy's due date is exceeded, a warning badge `⚠️ Policy Access Review is Overdue` is displayed to users in the Request Portal when selecting that group.

### 2. Conducting Reviews & Orphaned Access Detection
- Administrators can navigate to the **Settings > Access Reviews** tab to view all configured JIT policies grouped by space context.
- Policies requiring attestation are flagged with red **Overdue** status indicators.
- When an administrator clicks **"Certify"** on a JIT group policy, the system:
  1. Resets the certified timestamp and extends the next due date by the attestation interval.
  2. Queries the Google Workspace Directory API to list current active members.
  3. Compares the members against active JIT request sessions in the database.
  4. Identifies **orphaned access**—any direct member in the Google group who does **not** have an active JIT elevation request in the portal database.
  5. If orphaned access is found, a security warning list is returned to the UI, and a high-priority warning message is pushed to the configured Webhook.

---

## Manual Data Refresh

To trigger immediate synchronization of active requests, configurations, and user lists from the database, use the manual **Refresh** button (represented by a circular arrow icon) in the top-right header next to Settings. 
Clicking this button spins the icon and pulls the latest status changes instantly without requiring a full browser page reload.

---

The JIT Portal is now fully deployed, securely locked down by IAP, and integrated with live Google Workspace group memberships!
