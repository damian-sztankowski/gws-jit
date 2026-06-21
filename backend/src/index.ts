import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';
import { 
  getConfig, 
  saveConfig, 
  getRequests, 
  saveRequest, 
  updateRequest, 
  getLogs, 
  getAllLogs,
  addLog,
  getUsers,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  hashPassword,
  verifyPassword,
  getSpaces,
  saveSpace,
  deleteSpace
} from './db.js';
import { listGroups, addGroupMember, removeGroupMember, listGroupMembers } from './google.js';
import { startScheduler } from './scheduler.js';
import { JitRequest, User, UserRole, SpaceConfig, AuditLog } from './types.js';
import { sendNotification, dispatchTestWebhook } from './notifications.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const isProd = process.env.NODE_ENV === 'production' || process.env.AUTH_MODE === 'IAP';
if (!isProd) {
  console.log("[CORS] Development mode: enabling CORS for http://localhost:3000");
  app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
  }));
} else {
  console.log("[CORS] Production/IAP mode: CORS disabled (served from same origin)");
}
app.use(express.json());

// Memory map for user sessions (token -> email)
const SESSIONS = new Map<string, string>();

// Extended Express Request to support user context
interface AuthenticatedRequest extends express.Request {
  user?: User;
}

const oAuth2Client = new OAuth2Client();

// Authentication middleware supporting IAP SSO or Local Token sessions
const requireAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (process.env.AUTH_MODE === 'IAP') {
    const iapEmailHeader = req.headers['x-goog-authenticated-user-email'] as string;
    const iapJwt = req.headers['x-goog-iap-jwt-assertion'] as string;

    if (!iapEmailHeader || !iapJwt) {
      return res.status(401).json({ error: "Unauthorized. Missing Google IAP authentication headers." });
    }

    try {
      const audience = process.env.IAP_AUDIENCE || '';
      const certs = await oAuth2Client.getIapPublicKeys();
      const ticket = await oAuth2Client.verifySignedJwtWithCertsAsync(
        iapJwt,
        certs.pubkeys,
        audience,
        ['https://cloud.google.com/iap']
      );
      const payload = ticket.getPayload();
      
      if (!payload || !payload.email) {
        return res.status(401).json({ error: "Unauthorized. Invalid IAP JWT payload." });
      }

      const email = payload.email.toLowerCase().trim();
      const user = await getUserByEmail(email);
      if (!user) {
        return res.status(403).json({ error: `Access Denied. User '${email}' is not configured in the JIT portal. Please contact an administrator.` });
      }

      (req as any).user = user;
      next();
    } catch (err) {
      return res.status(401).json({ error: `Unauthorized. Google IAP JWT verification failed: ${(err as Error).message}` });
    }
    return;
  }

  // Fallback to local token-based authentication
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized. Missing session token." });
  }
  const token = authHeader.substring(7);
  const email = SESSIONS.get(token);
  if (!email) {
    return res.status(401).json({ error: "Unauthorized. Session has expired or is invalid." });
  }
  const user = await getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: "User profile no longer exists." });
  }
  (req as any).user = user;
  next();
};

// Role-Based Access Control middleware
const requireRole = (allowedRoles: UserRole[]) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user as User;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `Forbidden. Your role '${user?.role || 'Unknown'}' is not authorized to perform this action.` });
    }
    next();
  };
};

// 1. Authentication Endpoints
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    console.log(`[AUTH] Login attempt for: ${email}`);
    const user = await getUserByEmail(email);
    if (!user) {
      console.log(`[AUTH] User not found: ${email}`);
      try {
        const allUsers = await getUsers();
        console.log(`[AUTH] Total users currently in DB: ${allUsers.length}`);
      } catch (dbErr) {
        console.error(`[AUTH] Failed to count users in DB: ${(dbErr as Error).message}`);
      }
      return res.status(401).json({ error: "Invalid email or password." });
    }
    if (!verifyPassword(password, user.password || '')) {
      console.log(`[AUTH] Password verification failed for: ${email}`);
      return res.status(401).json({ error: "Invalid email or password." });
    }
    
    // Dynamic security upgrade: Upgrade legacy password hash to v2 (210,000 iterations) if verification succeeds
    if (user.password && !user.password.startsWith('v2:')) {
      console.log(`[SECURITY] Upgrading legacy password hash to v2 for user: ${email}`);
      const updatedUser = { ...user, password: hashPassword(password) };
      await updateUser(user.email, updatedUser);
    }
    
    console.log(`[AUTH] Successful login for: ${email}`);
    // Generate simple secure token
    const token = 'token_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    SESSIONS.set(token, user.email);
    
    // Return token and user info (excluding password)
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (error) {
    console.error(`[AUTH] Login handler exception: ${(error as Error).message}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = (req as any).user as User;
  const { password: _, ...safeUser } = user;
  res.json({ 
    user: safeUser,
    authMode: process.env.AUTH_MODE || 'LOCAL'
  });
});

// 2. Config Endpoints
app.get('/api/config', requireAuth, async (req, res) => {
  try {
    const config = await getConfig();
    res.json({
      mode: config.mode,
      domain: config.domain,
      autoApproval: config.autoApproval,
      serviceAccountEmail: config.serviceAccountEmail || '',
      hasServiceAccount: !!config.serviceAccountJson,
      adminEmail: config.adminEmail,
      groupPolicies: config.groupPolicies || [],
      webhookUrl: config.webhookUrl,
      eligibleAttributes: config.eligibleAttributes || [],
      attestationIntervalDays: config.attestationIntervalDays !== undefined ? config.attestationIntervalDays : 90
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/config', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { mode, domain, serviceAccountJson, serviceAccountEmail, adminEmail, autoApproval, groupPolicies, webhookUrl, eligibleAttributes, attestationIntervalDays } = req.body;
    const actor = ((req as any).user as User).email;
    
    const currentConfig = await getConfig();
    
    const newConfig = {
      mode: mode || currentConfig.mode,
      domain: domain || currentConfig.domain,
      autoApproval: typeof autoApproval === 'boolean' ? autoApproval : currentConfig.autoApproval,
      adminEmail: adminEmail !== undefined ? adminEmail : currentConfig.adminEmail,
      serviceAccountJson: serviceAccountJson !== undefined ? serviceAccountJson : currentConfig.serviceAccountJson,
      serviceAccountEmail: serviceAccountEmail !== undefined ? serviceAccountEmail : currentConfig.serviceAccountEmail,
      groupPolicies: groupPolicies !== undefined ? groupPolicies : currentConfig.groupPolicies || [],
      webhookUrl: webhookUrl !== undefined ? webhookUrl : currentConfig.webhookUrl,
      eligibleAttributes: eligibleAttributes !== undefined ? eligibleAttributes : currentConfig.eligibleAttributes || [],
      attestationIntervalDays: attestationIntervalDays !== undefined ? Number(attestationIntervalDays) : (currentConfig.attestationIntervalDays !== undefined ? currentConfig.attestationIntervalDays : 90)
    };
    
    await saveConfig(newConfig);
    await addLog(actor, 'UPDATE_CONFIG', `Updated system configuration. Mode: ${newConfig.mode}, AutoApproval: ${newConfig.autoApproval}`);
    
    res.json({ success: true, config: {
      mode: newConfig.mode,
      domain: newConfig.domain,
      autoApproval: newConfig.autoApproval,
      serviceAccountEmail: newConfig.serviceAccountEmail || '',
      hasServiceAccount: !!newConfig.serviceAccountJson,
      adminEmail: newConfig.adminEmail,
      groupPolicies: newConfig.groupPolicies,
      webhookUrl: newConfig.webhookUrl,
      eligibleAttributes: newConfig.eligibleAttributes,
      attestationIntervalDays: newConfig.attestationIntervalDays
    }});
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/config/test-webhook', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    if (!webhookUrl) {
      return res.status(400).json({ error: "Webhook URL is required." });
    }
    await dispatchTestWebhook(webhookUrl);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/config/policies/attest', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { groupEmail } = req.body;
    const actor = ((req as any).user as User).email;
    if (!groupEmail) {
      return res.status(400).json({ error: "Group Email is required." });
    }

    const config = await getConfig();
    const policyIndex = (config.groupPolicies || []).findIndex(p => p.groupEmail.toLowerCase() === groupEmail.toLowerCase());
    if (policyIndex === -1) {
      return res.status(404).json({ error: "Policy not found for this group." });
    }

    // Scan current members in Google Directory
    console.log(`[ATTESTATION] Scanning members for global group ${groupEmail}...`);
    const members = await listGroupMembers(groupEmail);
    const requests = await getRequests();
    
    // Find active requests in our DB
    const activeRequesters = requests
      .filter(r => r.status === 'ACTIVE' && r.groupEmail.toLowerCase() === groupEmail.toLowerCase())
      .map(r => r.requesterEmail.toLowerCase());

    const adminEmail = config.adminEmail?.toLowerCase() || '';

    // Filter orphaned members
    const orphanedMembers = members.filter(m => {
      const email = m.toLowerCase();
      return email !== 'superadmin@company.com' && email !== adminEmail && !activeRequesters.includes(email);
    });

    if (orphanedMembers.length > 0) {
      console.warn(`[ATTESTATION] Orphaned access detected in global group ${groupEmail}: ${orphanedMembers.join(', ')}`);
      await sendNotification(groupEmail, {
        title: "⚠️ [SECURITY WARNING] Orphaned Access Detected",
        message: `During attestation review of global group ${groupEmail}, orphaned access was detected. The following users are direct members of the Google Group but have no active JIT elevation request in the portal: ${orphanedMembers.join(', ')}.`
      });
      await addLog('SYSTEM', 'ORPHANED_ACCESS_DETECTED', `Orphaned members detected in group ${groupEmail}: ${orphanedMembers.join(', ')}`);
    }

    // Update attestation timestamps
    const intervalDays = config.attestationIntervalDays || 90;
    const now = new Date();
    const policy = config.groupPolicies![policyIndex];
    policy.lastCertifiedAt = now.toISOString();
    policy.lastCertifiedBy = actor;
    policy.attestationDueAt = new Date(now.getTime() + intervalDays * 24 * 3600000).toISOString();

    await saveConfig(config);
    await addLog(actor, 'ATTEST_POLICY', `Attested JIT policy for global group ${groupEmail}. Certified: ${now.toISOString()}`);

    res.json({ success: true, policy, orphanedMembers });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/spaces/:spaceId/policies/attest', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { groupEmail } = req.body;
    const actor = ((req as any).user as User).email;
    if (!groupEmail) {
      return res.status(400).json({ error: "Group Email is required." });
    }

    const spaces = await getSpaces();
    const spaceIndex = spaces.findIndex(s => s.id === spaceId);
    if (spaceIndex === -1) {
      return res.status(404).json({ error: "Space not found." });
    }

    const space = spaces[spaceIndex];
    const policyIndex = (space.groupPolicies || []).findIndex(p => p.groupEmail.toLowerCase() === groupEmail.toLowerCase());
    if (policyIndex === -1) {
      return res.status(404).json({ error: "Policy not found for this group in space." });
    }

    // Scan current members in Google Directory
    console.log(`[ATTESTATION] Scanning members for space ${space.name} group ${groupEmail}...`);
    const members = await listGroupMembers(groupEmail);
    const requests = await getRequests();
    
    // Find active requests in our DB
    const activeRequesters = requests
      .filter(r => r.status === 'ACTIVE' && r.groupEmail.toLowerCase() === groupEmail.toLowerCase())
      .map(r => r.requesterEmail.toLowerCase());

    const config = await getConfig();
    const spaceAdmin = space.adminEmail?.toLowerCase() || '';
    const globalAdmin = config.adminEmail?.toLowerCase() || '';

    // Filter orphaned members
    const orphanedMembers = members.filter(m => {
      const email = m.toLowerCase();
      return email !== 'superadmin@company.com' && email !== spaceAdmin && email !== globalAdmin && !activeRequesters.includes(email);
    });

    if (orphanedMembers.length > 0) {
      console.warn(`[ATTESTATION] Orphaned access detected in space ${space.name} group ${groupEmail}: ${orphanedMembers.join(', ')}`);
      await sendNotification(groupEmail, {
        title: "⚠️ [SECURITY WARNING] Orphaned Access Detected",
        message: `During attestation review of group ${groupEmail} in Space [${space.name}], orphaned access was detected. The following users are direct members of the Google Group but have no active JIT elevation request in the portal: ${orphanedMembers.join(', ')}.`
      });
      await addLog('SYSTEM', 'ORPHANED_ACCESS_DETECTED', `Orphaned members detected in space ${space.name} group ${groupEmail}: ${orphanedMembers.join(', ')}`);
    }

    // Update attestation timestamps
    const intervalDays = config.attestationIntervalDays || 90;
    const now = new Date();
    const policy = space.groupPolicies![policyIndex];
    policy.lastCertifiedAt = now.toISOString();
    policy.lastCertifiedBy = actor;
    policy.attestationDueAt = new Date(now.getTime() + intervalDays * 24 * 3600000).toISOString();

    await saveSpace(space);
    await addLog(actor, 'ATTEST_POLICY', `Attested JIT policy for group ${groupEmail} in Space ${space.name}. Certified: ${now.toISOString()}`);

    res.json({ success: true, policy, orphanedMembers });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 2.5. User Management Endpoints (ADMIN only)
app.get('/api/users', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const users = await getUsers();
    const safeUsers = users.map(u => {
      const { password, ...safeUser } = u;
      return safeUser;
    });
    res.json(safeUsers);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/users', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const { email, name, role, password, attributes, assignedSpaces } = req.body;
    
    if (!email || !name || !role || !password) {
      return res.status(400).json({ error: "Email, Name, Role and Password are required." });
    }

    const newUser: User = {
      email: email.trim().toLowerCase(),
      name: name.trim(),
      role,
      password,
      attributes: attributes || [],
      assignedSpaces: assignedSpaces || []
    };

    await createUser(newUser);
    await addLog(actor, 'CREATE_USER', `Created user account: ${newUser.email} with role ${role}`);
    
    const { password: _, ...safeNewUser } = newUser;
    res.json({ success: true, user: safeNewUser });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/api/users/:email', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const emailToUpdate = req.params.email.toLowerCase();
    const { name, role, password, attributes, assignedSpaces } = req.body;

    if (!name || !role) {
      return res.status(400).json({ error: "Name and Role are required." });
    }

    if (emailToUpdate === actor.toLowerCase() && role !== 'ADMIN') {
      return res.status(400).json({ error: "Lockout Guard: You cannot demote your own Admin role." });
    }

    const updatedUser: User = {
      email: emailToUpdate,
      name: name.trim(),
      role,
      password: password || '', // db.ts preserves existing if empty
      attributes: attributes || [],
      assignedSpaces: assignedSpaces || []
    };

    await updateUser(emailToUpdate, updatedUser);
    await addLog(actor, 'UPDATE_USER', `Updated user account: ${emailToUpdate}`);
    
    const { password: _, ...safeUpdated } = updatedUser;
    res.json({ success: true, user: safeUpdated });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/users/:email', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const emailToDelete = req.params.email.toLowerCase();

    if (emailToDelete === actor.toLowerCase()) {
      return res.status(400).json({ error: "Lockout Guard: You cannot delete your own active Admin account." });
    }

    await deleteUser(emailToDelete);
    await addLog(actor, 'DELETE_USER', `Deleted user account: ${emailToDelete}`);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 2.7. Spaces CRUD Endpoints (GET allowed for all authenticated users with redaction, modifications ADMIN only)
app.get('/api/spaces', requireAuth, async (req, res) => {
  try {
    const spaces = await getSpaces();
    const user = (req as any).user as User;
    
    if (user.role === 'ADMIN') {
      res.json(spaces);
    } else {
      // Redact sensitive details for non-admin users
      const redacted = spaces.map(s => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        adminEmail: s.adminEmail,
        serviceAccountEmail: s.serviceAccountEmail,
        autoApproval: s.autoApproval,
        groupPolicies: s.groupPolicies
      }));
      res.json(redacted);
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/spaces', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const { name, domain, adminEmail, serviceAccountJson, serviceAccountEmail, autoApproval, groupPolicies, webhookUrl } = req.body;
    
    if (!name || !domain || !adminEmail) {
      return res.status(400).json({ error: "Name, Domain, and Admin Email are required." });
    }

    const newSpace: SpaceConfig = {
      id: `space_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      adminEmail: adminEmail.trim().toLowerCase(),
      serviceAccountJson: serviceAccountJson || undefined,
      serviceAccountEmail: serviceAccountEmail || undefined,
      autoApproval: !!autoApproval,
      groupPolicies: groupPolicies || [],
      webhookUrl: webhookUrl || undefined
    };

    await saveSpace(newSpace);
    await addLog(actor, 'CREATE_SPACE', `Created space '${newSpace.name}' for domain '${newSpace.domain}'`);
    res.json({ success: true, space: newSpace });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.put('/api/spaces/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const { id } = req.params;
    const { name, domain, adminEmail, serviceAccountJson, serviceAccountEmail, autoApproval, groupPolicies, webhookUrl } = req.body;

    if (!name || !domain || !adminEmail) {
      return res.status(400).json({ error: "Name, Domain, and Admin Email are required." });
    }

    const updatedSpace: SpaceConfig = {
      id,
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      adminEmail: adminEmail.trim().toLowerCase(),
      serviceAccountJson: serviceAccountJson || undefined,
      serviceAccountEmail: serviceAccountEmail || undefined,
      autoApproval: !!autoApproval,
      groupPolicies: groupPolicies || [],
      webhookUrl: webhookUrl || undefined
    };

    await saveSpace(updatedSpace);
    await addLog(actor, 'UPDATE_SPACE', `Updated space '${updatedSpace.name}' config.`);
    res.json({ success: true, space: updatedSpace });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/spaces/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const { id } = req.params;

    await deleteSpace(id);
    await addLog(actor, 'DELETE_SPACE', `Deleted space with ID ${id}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 3. Groups Endpoints
app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const groups = await listGroups();
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 4. Requests Endpoints
app.get('/api/requests', requireAuth, async (req, res) => {
  try {
    const requests = await getRequests();
    const user = (req as any).user as User;
    
    if (user.role === 'ADMIN' || user.role === 'AUDITOR') {
      return res.json(requests);
    }
    
    const assigned = user.assignedSpaces || [];
    const filtered = requests.filter(r => {
      const isOwner = r.requesterEmail.toLowerCase() === user.email.toLowerCase();
      const rSpace = r.spaceId || 'global';
      const isInAssignedSpace = assigned.includes(rSpace);
      return isOwner || isInAssignedSpace;
    });
    
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

async function resolveSpaceSettings(groupEmail: string) {
  const config = await getConfig();
  const spaces = await getSpaces();
  const normalizedGroupEmail = groupEmail.toLowerCase().trim();

  // 1. Try to find a Space that explicitly has this group email in its policies
  let space = spaces.find(s => 
    (s.groupPolicies || []).some(p => p.groupEmail.toLowerCase().trim() === normalizedGroupEmail)
  );

  // 2. Fall back to domain suffix matching
  if (!space) {
    const domain = groupEmail.split('@')[1]?.toLowerCase();
    space = spaces.find(s => s.domain.toLowerCase() === domain);
  }

  if (space) {
    return {
      spaceId: space.id,
      spaceName: space.name,
      autoApproval: space.autoApproval,
      groupPolicies: space.groupPolicies || [],
      isSpace: true
    };
  }
  
  return {
    spaceId: undefined,
    spaceName: 'Global',
    autoApproval: config.autoApproval,
    groupPolicies: config.groupPolicies || [],
    isSpace: false
  };
}

app.post('/api/requests', requireAuth, requireRole(['REQUESTER', 'ADMIN']), async (req, res) => {
  try {
    const { groupEmail, groupName, justification, durationMinutes, spaceId } = req.body;
    const user = (req as any).user as User;
    const requesterEmail = user.email;
    
    if (!groupEmail || !groupName || !justification || !durationMinutes) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    const resolvedSettings = await resolveSpaceSettings(groupEmail);
    const targetSpace = resolvedSettings.spaceId || 'global';
    
    if (user.role !== 'ADMIN') {
      const assigned = user.assignedSpaces || [];
      if (!assigned.includes(targetSpace)) {
        return res.status(403).json({ 
          error: `Access Denied. You are not authorized to submit JIT requests for the space '${resolvedSettings.spaceName}'.` 
        });
      }
    }

    // ABAC Guard - Verify User parameters match Group JIT eligibility policy rules (Space-specific or Global)
    const policy = resolvedSettings.groupPolicies.find(p => p.groupEmail.toLowerCase() === groupEmail.toLowerCase());
    if (policy && policy.requiredAttributes && policy.requiredAttributes.length > 0) {
      const userAttrs = user.attributes || [];
      const missingAttributes = policy.requiredAttributes.filter(attr => !userAttrs.includes(attr));
      if (missingAttributes.length > 0) {
        return res.status(403).json({ 
          error: `Access Denied. Membership in this group requires authorization tags: ${missingAttributes.join(', ')}` 
        });
      }
    }

    const newRequest: JitRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      requesterEmail,
      groupEmail,
      groupName,
      justification,
      durationMinutes: Number(durationMinutes),
      requestedAt: new Date().toISOString(),
      status: 'PENDING',
      spaceId: spaceId || resolvedSettings.spaceId
    };

    await addLog(requesterEmail, 'REQUEST_JIT', `Requested temporary membership in ${groupName} for ${durationMinutes}m (Space: ${resolvedSettings.spaceName}). Reason: ${justification}`);

    const isAutoApproved = resolvedSettings.autoApproval || (policy && !!policy.autoApproval);
    if (isAutoApproved) {
      console.log(`[API] Auto-approving JIT request ${newRequest.id} (Space: ${resolvedSettings.spaceName})`);
      try {
        // Add member to Google Group
        await addGroupMember(groupEmail, requesterEmail);
        
        newRequest.status = 'ACTIVE';
        newRequest.activatedAt = new Date().toISOString();
        newRequest.expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString();
        newRequest.approverEmail = 'SYSTEM (Auto-Approved)';
        newRequest.approvedAt = new Date().toISOString();

        await saveRequest(newRequest);
        await addLog('SYSTEM', 'ACTIVATE_JIT', `Added ${requesterEmail} to group ${groupName} (Auto-Approved, Space: ${resolvedSettings.spaceName}). Expiry: ${newRequest.expiresAt}`);
        
        // Dispatch Notification
        await sendNotification(groupEmail, {
          title: `JIT Request APPROVED (Auto-Approved)`,
          message: `JIT request for ${requesterEmail} to join group ${groupName} in Space ${resolvedSettings.spaceName} was automatically approved and activated.`,
          requestDetails: {
            id: newRequest.id,
            requesterEmail,
            groupEmail,
            durationMinutes,
            justification,
            status: 'ACTIVE'
          }
        });

        return res.json({ success: true, request: newRequest });
      } catch (err) {
        console.error("Auto-activation failed:", err);
        newRequest.status = 'PENDING';
        await saveRequest(newRequest);
        await addLog('SYSTEM', 'ACTIVATE_ERROR', `Failed adding ${requesterEmail} to group ${groupName}: ${(err as Error).message}`);
        
        // Dispatch Notification
        await sendNotification(groupEmail, {
          title: `JIT Request PENDING (Auto-Activation Failed)`,
          message: `JIT request for ${requesterEmail} to join group ${groupName} failed automatic provisioning: ${(err as Error).message}`,
          requestDetails: {
            id: newRequest.id,
            requesterEmail,
            groupEmail,
            durationMinutes,
            justification,
            status: 'PENDING'
          }
        });

        return res.json({ success: false, error: `Auto-approval failed to provision group membership: ${(err as Error).message}`, request: newRequest });
      }
    } else {
      // Manual peer approval path
      await saveRequest(newRequest);
      
      // Dispatch Notification
      await sendNotification(groupEmail, {
        title: `JIT Request PENDING`,
        message: `JIT request for ${requesterEmail} to join group ${groupName} (Space: ${resolvedSettings.spaceName}) is pending peer approval.`,
        requestDetails: {
          id: newRequest.id,
          requesterEmail,
          groupEmail,
          durationMinutes,
          justification,
          status: 'PENDING'
        }
      });

      res.json({ success: true, request: newRequest });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/requests/:id/approve', requireAuth, requireRole(['APPROVER', 'ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const approverEmail = ((req as any).user as User).email;
    const requests = await getRequests();
    const request = requests.find(r => r.id === id);

    if (!request) {
      return res.status(404).json({ error: "Request not found." });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot approve request in ${request.status} status.` });
    }

    if (request.requesterEmail === approverEmail) {
      return res.status(400).json({ error: "Self-approval is not allowed. Please have an independent peer authorize your request." });
    }

    try {
      console.log(`[API] Provisioning group membership for request ${request.id}`);
      await addGroupMember(request.groupEmail, request.requesterEmail);

      const updatedRequest: JitRequest = {
        ...request,
        status: 'ACTIVE',
        approverEmail,
        approvedAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + request.durationMinutes * 60000).toISOString()
      };

      await updateRequest(updatedRequest);
      await addLog(approverEmail, 'APPROVE_JIT', `Approved JIT group membership request ${request.id} for ${request.requesterEmail}`);
      await addLog('SYSTEM', 'ACTIVATE_JIT', `Added ${request.requesterEmail} to group ${request.groupName}. Expiry: ${updatedRequest.expiresAt}`);
      
      // Dispatch Notification
      await sendNotification(request.groupEmail, {
        title: `JIT Request APPROVED`,
        message: `JIT request for ${request.requesterEmail} to join group ${request.groupName} has been approved by ${approverEmail} and is now active.`,
        requestDetails: {
          id: request.id,
          requesterEmail: request.requesterEmail,
          groupEmail: request.groupEmail,
          durationMinutes: request.durationMinutes,
          justification: request.justification,
          status: 'ACTIVE'
        }
      });

      res.json({ success: true, request: updatedRequest });
    } catch (err) {
      console.error("Manual group membership provisioning failed:", err);
      await addLog(approverEmail, 'APPROVE_ERROR', `Failed adding member for request ${request.id}: ${(err as Error).message}`);
      res.status(500).json({ error: `Provisioning group membership failed: ${(err as Error).message}` });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/requests/:id/deny', requireAuth, requireRole(['APPROVER', 'ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const approverEmail = ((req as any).user as User).email;
    const requests = await getRequests();
    const request = requests.find(r => r.id === id);

    if (!request) {
      return res.status(404).json({ error: "Request not found." });
    }

    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: `Cannot deny request in ${request.status} status.` });
    }

    const updatedRequest: JitRequest = {
      ...request,
      status: 'DENIED',
      approverEmail,
      approvedAt: new Date().toISOString()
    };

    await updateRequest(updatedRequest);
    await addLog(approverEmail, 'DENY_JIT', `Denied membership request ${request.id} for ${request.requesterEmail}`);
    
    // Dispatch Notification
    await sendNotification(request.groupEmail, {
      title: `JIT Request DENIED`,
      message: `JIT request for ${request.requesterEmail} to join group ${request.groupName} was rejected by ${approverEmail}.`,
      requestDetails: {
        id: request.id,
        requesterEmail: request.requesterEmail,
        groupEmail: request.groupEmail,
        durationMinutes: request.durationMinutes,
        justification: request.justification,
        status: 'DENIED'
      }
    });

    res.json({ success: true, request: updatedRequest });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/requests/:id/revoke', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user as User;
    const actor = user.email;
    const requests = await getRequests();
    const request = requests.find(r => r.id === id);

    if (!request) {
      return res.status(404).json({ error: "Request not found." });
    }

    if (request.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Cannot revoke request in ${request.status} status.` });
    }

    // Role Guard: Requesters can only revoke their own sessions. Admins/Approvers can revoke any. Auditors are not allowed.
    if (user.role === 'AUDITOR') {
      return res.status(403).json({ error: "Forbidden. Auditors are not authorized to revoke access." });
    }

    if (user.role === 'REQUESTER' && request.requesterEmail !== actor) {
      return res.status(403).json({ error: "Forbidden. Requesters are only allowed to revoke their own sessions." });
    }

    try {
      // Remove membership early
      await removeGroupMember(request.groupEmail, request.requesterEmail);

      const updatedRequest: JitRequest = {
        ...request,
        status: 'REVOKED',
        revokedAt: new Date().toISOString()
      };

      await updateRequest(updatedRequest);
      await addLog(actor, 'REVOKE_JIT', `Manually removed ${request.requesterEmail} from group ${request.groupName}`);
      
      // Dispatch Notification
      await sendNotification(request.groupEmail, {
        title: `JIT Request REVOKED`,
        message: `JIT access for ${request.requesterEmail} to group ${request.groupName} was manually revoked by ${actor}.`,
        requestDetails: {
          id: request.id,
          requesterEmail: request.requesterEmail,
          groupEmail: request.groupEmail,
          durationMinutes: request.durationMinutes,
          justification: request.justification,
          status: 'REVOKED'
        }
      });

      res.json({ success: true, request: updatedRequest });
    } catch (err) {
      console.error("Manual group membership revocation failed:", err);
      res.status(500).json({ error: `Revocation failed: ${(err as Error).message}` });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 5. Logs Endpoints
app.get('/api/logs', requireAuth, requireRole(['ADMIN', 'AUDITOR']), async (req, res) => {
  try {
    const logs = await getLogs();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/logs/export', requireAuth, requireRole(['ADMIN', 'AUDITOR']), async (req, res) => {
  try {
    const logs = await getAllLogs();

    // Format as RFC 4180 compliant CSV
    const csvRows = [
      ['ID', 'Timestamp', 'Actor', 'Action', 'Details']
    ];
    for (const log of logs) {
      csvRows.push([
        log.id,
        log.timestamp,
        log.actor,
        log.action,
        log.details.replace(/"/g, '""')
      ]);
    }
    const csvContent = csvRows.map(row => row.map(val => `"${val}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=gws-jit-audit-logs-${Date.now()}.csv`);
    res.status(200).send(csvContent);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 6. Documentation Endpoints
app.get('/api/docs', requireAuth, async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const type = req.query.type === 'readme' ? 'README.md' : 'USER_MANUAL.md';
    let docPath = path.join(process.cwd(), type);
    try {
      await fs.access(docPath);
    } catch {
      docPath = path.join(process.cwd(), '..', type);
    }
    const content = await fs.readFile(docPath, 'utf8');
    res.json({ content });
  } catch (error) {
    res.status(500).json({ error: "Failed to read system documentation." });
  }
});

// Serve frontend static assets in production
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Fallback index.html for SPA routing
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  res.sendFile(path.join(frontendDistPath, 'index.html'), (err) => {
    if (err) {
      next();
    }
  });
});

app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`[API] Group JIT Server running on http://0.0.0.0:${PORT}`);
  // Tick every 10 seconds to detect expirations rapidly in dev/demo
  startScheduler(10000); 

  // Security Audit: Check for default passwords in local database
  if (process.env.AUTH_MODE !== 'IAP') {
    try {
      const users = await getUsers();
      const defaultUsers = ['superadmin@company.com'];
      let usingDefaults = false;
      for (const email of defaultUsers) {
        const user = users.find(u => u.email.toLowerCase() === email);
        if (user && verifyPassword('password', user.password || '')) {
          usingDefaults = true;
          console.warn(`[SECURITY WARNING] User '${email}' is still using the default password 'password'. Please change it immediately!`);
        }
      }
      if (usingDefaults) {
        console.warn(`[SECURITY WARNING] Default credentials detected in Local Auth mode. Do NOT deploy to production with default credentials!`);
      }
    } catch (err) {
      console.error("[SECURITY CHECK] Failed to run default credentials audit:", err);
    }
  }
});
