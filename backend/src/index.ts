import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
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
  deleteSpace,
  saveSession,
  getSession,
  deleteSession,
  deleteSessionsByEmail,
  cleanupExpiredSessions
} from './db.js';
import {
  listGroups,
  addGroupMember,
  removeGroupMember,
  listGroupMembers,
  clearGoogleTokenCache
} from './google.js';
import { startScheduler, stopScheduler, checkExpiredRequests } from './scheduler.js';
import { JitRequest, JitApprovalEntry, User, UserRole, SpaceConfig } from './types.js';
import { sendNotification, dispatchTestWebhook } from './notifications.js';
import { registerSseClient, broadcastEvent, logStructured } from './events.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy for accurate client IP behind Cloud Run / HTTPS Load Balancer / IAP
app.set('trust proxy', 1);
app.disable('x-powered-by');

const isProd = process.env.NODE_ENV === 'production' || process.env.AUTH_MODE === 'IAP';

// Enterprise HTTP Security Headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' https://accounts.google.com https://*.google.com; frame-src 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com"
  );
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

if (!isProd) {
  logStructured('INFO', 'CORS', 'Development mode: enabling CORS for http://localhost:3000');
  app.use(
    cors({
      origin: 'http://localhost:3000',
      credentials: true
    })
  );
} else {
  logStructured('INFO', 'CORS', 'Production/IAP mode: same-origin serving active');
}

app.use(express.json({ limit: '100kb' }));

// Security Rate Limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again after 15 minutes.' }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Session TTL (8 hours)
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const sessionCleanupInterval = setInterval(() => {
  cleanupExpiredSessions().catch((err) =>
    logStructured('ERROR', 'SESSION', 'Cleanup error', { error: (err as Error).message })
  );
}, 15 * 60 * 1000);

const oAuth2Client = new OAuth2Client();

// Authentication middleware supporting IAP SSO or Local Token sessions
const requireAuth = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) => {
  if (process.env.AUTH_MODE === 'IAP') {
    const iapEmailHeader = req.headers['x-goog-authenticated-user-email'] as string;
    const iapJwt = req.headers['x-goog-iap-jwt-assertion'] as string;

    if (!iapEmailHeader || !iapJwt) {
      return res.status(401).json({ error: 'Unauthorized. Missing Google IAP authentication headers.' });
    }

    const audience = (process.env.IAP_AUDIENCE || '').trim();
    if (!audience) {
      logStructured('ERROR', 'SECURITY', 'AUTH_MODE is IAP, but IAP_AUDIENCE is not set');
      return res.status(500).json({ error: 'Server Misconfiguration: IAP_AUDIENCE is not configured.' });
    }

    try {
      const certs = await oAuth2Client.getIapPublicKeys();
      const ticket = await oAuth2Client.verifySignedJwtWithCertsAsync(
        iapJwt,
        certs.pubkeys,
        audience,
        ['https://cloud.google.com/iap']
      );
      const payload = ticket.getPayload();

      if (!payload || !payload.email) {
        return res.status(401).json({ error: 'Unauthorized. Invalid IAP JWT payload.' });
      }

      const email = payload.email.toLowerCase().trim();
      const user = await getUserByEmail(email);
      if (!user) {
        return res.status(403).json({
          error: `Access Denied. User '${email}' is not configured in the JIT portal. Please contact an administrator.`
        });
      }

      (req as any).user = user;
      next();
    } catch (err) {
      return res.status(401).json({
        error: `Unauthorized. Google IAP JWT verification failed: ${(err as Error).message}`
      });
    }
    return;
  }

  const authHeader = req.headers['authorization'];
  const queryToken =
    req.path === '/api/events' && typeof req.query.token === 'string'
      ? req.query.token
      : undefined;
  const rawToken =
    authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : queryToken;

  if (!rawToken) {
    return res.status(401).json({ error: 'Unauthorized. Missing session token.' });
  }
  const session = await getSession(rawToken);
  if (!session || session.expiresAt <= Date.now()) {
    if (session) await deleteSession(rawToken);
    return res.status(401).json({ error: 'Unauthorized. Session has expired or is invalid.' });
  }
  const user = await getUserByEmail(session.email);
  if (!user) {
    return res.status(401).json({ error: 'User profile no longer exists.' });
  }
  (req as any).user = user;
  next();
};

const requireRole = (allowedRoles: UserRole[]) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = (req as any).user as User;
    if (!user || !allowedRoles.includes(user.role)) {
      return res.status(403).json({
        error: `Forbidden. Your role '${user?.role || 'Unknown'}' is not authorized to perform this action.`
      });
    }
    next();
  };
};

// Real-time Server-Sent Events stream
app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);
  const unregister = registerSseClient(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch {
      clearInterval(heartbeat);
      unregister();
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregister();
  });
});

// 1. Authentication Endpoints
app.post('/api/auth/login', authLimiter, async (req, res) => {
  if (process.env.AUTH_MODE === 'IAP') {
    return res.status(403).json({ error: 'Local password authentication is disabled when AUTH_MODE is IAP.' });
  }
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await getUserByEmail(email);
    if (!user || !verifyPassword(password, user.password || '')) {
      logStructured('WARNING', 'AUTH', `Failed login attempt for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (user.password && !user.password.startsWith('v2:')) {
      const updatedUser = { ...user, password: hashPassword(password) };
      await updateUser(user.email, updatedUser);
    }

    const token = crypto.randomBytes(32).toString('hex');
    await saveSession(token, user.email, Date.now() + SESSION_TTL_MS);

    logStructured('INFO', 'AUTH', `Authenticated session for ${user.email}`);
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (error) {
    logStructured('ERROR', 'AUTH', 'Login handler exception', { error: (error as Error).message });
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

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    await deleteSession(token);
  }
  res.json({ success: true });
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

function validateOptionalCredentialsJson(rawJson?: string): void {
  if (!rawJson || !rawJson.trim()) return;
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON credentials format.');
  }
  if (parsed.type === 'service_account' && process.env.REQUIRE_KEYLESS_DWD === 'true') {
    throw new Error(
      'Raw service_account private keys are blocked by policy (REQUIRE_KEYLESS_DWD=true). Use keyless Workload Identity.'
    );
  }
}

// 2. Config Endpoints
app.get('/api/config', requireAuth, async (_req, res) => {
  try {
    const config = await getConfig();
    res.json({
      mode: config.mode,
      domain: config.domain,
      autoApproval: config.autoApproval,
      serviceAccountEmail: config.serviceAccountEmail || '',
      hasServiceAccount: !!(config.serviceAccountJson || process.env.GWS_SERVICE_ACCOUNT_JSON),
      adminEmail: config.adminEmail,
      groupPolicies: config.groupPolicies || [],
      webhookUrl: config.webhookUrl,
      eligibleAttributes: config.eligibleAttributes || [],
      attestationIntervalDays:
        config.attestationIntervalDays !== undefined ? config.attestationIntervalDays : 90
    });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/config', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const {
      mode,
      domain,
      serviceAccountJson,
      serviceAccountEmail,
      adminEmail,
      autoApproval,
      groupPolicies,
      webhookUrl,
      eligibleAttributes,
      attestationIntervalDays
    } = req.body;
    const actor = ((req as any).user as User).email;

    if (serviceAccountJson !== undefined && serviceAccountJson !== '') {
      validateOptionalCredentialsJson(serviceAccountJson);
    }

    const currentConfig = await getConfig();

    const newConfig = {
      mode: mode || currentConfig.mode,
      domain: domain || currentConfig.domain,
      autoApproval: typeof autoApproval === 'boolean' ? autoApproval : currentConfig.autoApproval,
      adminEmail: adminEmail !== undefined ? adminEmail : currentConfig.adminEmail,
      serviceAccountJson:
        serviceAccountJson !== undefined ? serviceAccountJson : currentConfig.serviceAccountJson,
      serviceAccountEmail:
        serviceAccountEmail !== undefined ? serviceAccountEmail : currentConfig.serviceAccountEmail,
      groupPolicies:
        groupPolicies !== undefined ? groupPolicies : currentConfig.groupPolicies || [],
      webhookUrl: webhookUrl !== undefined ? webhookUrl : currentConfig.webhookUrl,
      eligibleAttributes:
        eligibleAttributes !== undefined
          ? eligibleAttributes
          : currentConfig.eligibleAttributes || [],
      attestationIntervalDays:
        attestationIntervalDays !== undefined
          ? Number(attestationIntervalDays)
          : currentConfig.attestationIntervalDays !== undefined
            ? currentConfig.attestationIntervalDays
            : 90
    };

    await saveConfig(newConfig);
    clearGoogleTokenCache();
    await addLog(
      actor,
      'UPDATE_CONFIG',
      `Updated system configuration. Mode: ${newConfig.mode}, AutoApproval: ${newConfig.autoApproval}`
    );
    broadcastEvent('CONFIG_UPDATED');

    res.json({
      success: true,
      config: {
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
      }
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post('/api/config/test-webhook', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    if (!webhookUrl) {
      return res.status(400).json({ error: 'Webhook URL is required.' });
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
      return res.status(400).json({ error: 'Group Email is required.' });
    }

    const config = await getConfig();
    const policyIndex = (config.groupPolicies || []).findIndex(
      (p) => p.groupEmail.toLowerCase() === groupEmail.toLowerCase()
    );
    if (policyIndex === -1) {
      return res.status(404).json({ error: 'Policy not found for this group.' });
    }

    const members = await listGroupMembers(groupEmail);
    const requests = await getRequests();

    const activeRequesters = requests
      .filter(
        (r) => r.status === 'ACTIVE' && r.groupEmail.toLowerCase() === groupEmail.toLowerCase()
      )
      .map((r) => r.requesterEmail.toLowerCase());

    const adminEmail = config.adminEmail?.toLowerCase() || '';

    const orphanedMembers = members.filter((m) => {
      const email = m.toLowerCase();
      return (
        email !== 'superadmin@company.com' &&
        email !== adminEmail &&
        !activeRequesters.includes(email)
      );
    });

    if (orphanedMembers.length > 0) {
      await sendNotification(groupEmail, {
        title: '⚠️ [SECURITY WARNING] Orphaned Access Detected',
        message: `During attestation review of global group ${groupEmail}, orphaned access was detected. Direct members with no active JIT session: ${orphanedMembers.join(', ')}.`
      });
      await addLog(
        'SYSTEM',
        'ORPHANED_ACCESS_DETECTED',
        `Orphaned members detected in group ${groupEmail}: ${orphanedMembers.join(', ')}`
      );
    }

    const intervalDays = config.attestationIntervalDays || 90;
    const now = new Date();
    const policy = config.groupPolicies![policyIndex];
    policy.lastCertifiedAt = now.toISOString();
    policy.lastCertifiedBy = actor;
    policy.attestationDueAt = new Date(now.getTime() + intervalDays * 24 * 3600000).toISOString();

    await saveConfig(config);
    await addLog(
      actor,
      'ATTEST_POLICY',
      `Attested JIT policy for global group ${groupEmail}. Certified: ${now.toISOString()}`
    );
    broadcastEvent('POLICY_ATTESTED', { groupEmail });

    res.json({ success: true, policy, orphanedMembers });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post(
  '/api/spaces/:spaceId/policies/attest',
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const { spaceId } = req.params;
      const { groupEmail } = req.body;
      const actor = ((req as any).user as User).email;
      if (!groupEmail) {
        return res.status(400).json({ error: 'Group Email is required.' });
      }

      const spaces = await getSpaces();
      const spaceIndex = spaces.findIndex((s) => s.id === spaceId);
      if (spaceIndex === -1) {
        return res.status(404).json({ error: 'Space not found.' });
      }

      const space = spaces[spaceIndex];
      const policyIndex = (space.groupPolicies || []).findIndex(
        (p) => p.groupEmail.toLowerCase() === groupEmail.toLowerCase()
      );
      if (policyIndex === -1) {
        return res.status(404).json({ error: 'Policy not found for this group in space.' });
      }

      const members = await listGroupMembers(groupEmail);
      const requests = await getRequests();

      const activeRequesters = requests
        .filter(
          (r) => r.status === 'ACTIVE' && r.groupEmail.toLowerCase() === groupEmail.toLowerCase()
        )
        .map((r) => r.requesterEmail.toLowerCase());

      const config = await getConfig();
      const spaceAdmin = space.adminEmail?.toLowerCase() || '';
      const globalAdmin = config.adminEmail?.toLowerCase() || '';

      const orphanedMembers = members.filter((m) => {
        const email = m.toLowerCase();
        return (
          email !== 'superadmin@company.com' &&
          email !== spaceAdmin &&
          email !== globalAdmin &&
          !activeRequesters.includes(email)
        );
      });

      if (orphanedMembers.length > 0) {
        await sendNotification(groupEmail, {
          title: '⚠️ [SECURITY WARNING] Orphaned Access Detected',
          message: `During attestation review of group ${groupEmail} in Space [${space.name}], orphaned access was detected: ${orphanedMembers.join(', ')}.`
        });
        await addLog(
          'SYSTEM',
          'ORPHANED_ACCESS_DETECTED',
          `Orphaned members detected in space ${space.name} group ${groupEmail}: ${orphanedMembers.join(', ')}`
        );
      }

      const intervalDays = config.attestationIntervalDays || 90;
      const now = new Date();
      const policy = space.groupPolicies![policyIndex];
      policy.lastCertifiedAt = now.toISOString();
      policy.lastCertifiedBy = actor;
      policy.attestationDueAt = new Date(
        now.getTime() + intervalDays * 24 * 3600000
      ).toISOString();

      await saveSpace(space);
      await addLog(
        actor,
        'ATTEST_POLICY',
        `Attested JIT policy for group ${groupEmail} in Space ${space.name}. Certified: ${now.toISOString()}`
      );
      broadcastEvent('POLICY_ATTESTED', { groupEmail, spaceId });

      res.json({ success: true, policy, orphanedMembers });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

// One-Click Orphaned Member Remediation
const RemediateOrphanSchema = z.object({
  groupEmail: z.string().trim().email('Valid group email is required.'),
  memberEmail: z.string().trim().email('Valid member email is required.')
});

app.post(
  '/api/config/policies/remediate-orphan',
  apiLimiter,
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const parsed = RemediateOrphanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
      }
      const { groupEmail, memberEmail } = parsed.data;
      const actor = ((req as any).user as User).email;
      const config = await getConfig();

      const lowerMember = memberEmail.toLowerCase();
      if (
        lowerMember === 'superadmin@company.com' ||
        lowerMember === (config.adminEmail || '').toLowerCase()
      ) {
        return res.status(400).json({ error: 'Cannot remove protected operator/admin account.' });
      }

      await removeGroupMember(groupEmail, memberEmail);
      await addLog(
        actor,
        'REMEDIATE_ORPHANED_ACCESS',
        `Removed unauthorized direct member ${memberEmail} from global group ${groupEmail}`
      );
      await sendNotification(groupEmail, {
        title: '🛡️ Orphaned Access Remediated',
        message: `Administrator ${actor} removed unauthorized standing member ${memberEmail} from ${groupEmail}.`
      });
      broadcastEvent('ORPHAN_REMEDIATED', { groupEmail, memberEmail });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.post(
  '/api/spaces/:spaceId/policies/remediate-orphan',
  apiLimiter,
  requireAuth,
  requireRole(['ADMIN']),
  async (req, res) => {
    try {
      const { spaceId } = req.params;
      const parsed = RemediateOrphanSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
      }
      const { groupEmail, memberEmail } = parsed.data;
      const actor = ((req as any).user as User).email;

      const spaces = await getSpaces();
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) {
        return res.status(404).json({ error: 'Space not found.' });
      }

      const config = await getConfig();
      const lowerMember = memberEmail.toLowerCase();
      if (
        lowerMember === 'superadmin@company.com' ||
        lowerMember === (space.adminEmail || '').toLowerCase() ||
        lowerMember === (config.adminEmail || '').toLowerCase()
      ) {
        return res.status(400).json({ error: 'Cannot remove protected operator/admin account.' });
      }

      await removeGroupMember(groupEmail, memberEmail);
      await addLog(
        actor,
        'REMEDIATE_ORPHANED_ACCESS',
        `Removed unauthorized direct member ${memberEmail} from group ${groupEmail} in Space ${space.name}`
      );
      await sendNotification(groupEmail, {
        title: '🛡️ Orphaned Access Remediated',
        message: `Administrator ${actor} removed unauthorized standing member ${memberEmail} from ${groupEmail} (Space: ${space.name}).`
      });
      broadcastEvent('ORPHAN_REMEDIATED', { groupEmail, memberEmail, spaceId });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

// 2.5. User Management Endpoints (ADMIN only)
app.get('/api/users', requireAuth, requireRole(['ADMIN']), async (_req, res) => {
  try {
    const users = await getUsers();
    const safeUsers = users.map((u) => {
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
      return res.status(400).json({ error: 'Email, Name, Role and Password are required.' });
    }

    if (password.length < 8) {
      return res
        .status(400)
        .json({ error: 'Password policy error: Password must be at least 8 characters long.' });
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
      return res.status(400).json({ error: 'Name and Role are required.' });
    }

    const passwordChanged = Boolean(password && password.trim() !== '');
    if (passwordChanged && password.length < 8) {
      return res
        .status(400)
        .json({ error: 'Password policy error: Password must be at least 8 characters long.' });
    }

    if (emailToUpdate === actor.toLowerCase() && role !== 'ADMIN') {
      return res
        .status(400)
        .json({ error: 'Lockout Guard: You cannot demote your own Admin role.' });
    }

    const existingUser = await getUserByEmail(emailToUpdate);
    const roleChanged = existingUser && existingUser.role !== role;

    const updatedUser: User = {
      email: emailToUpdate,
      name: name.trim(),
      role,
      password: password || '',
      attributes: attributes || [],
      assignedSpaces: assignedSpaces || []
    };

    await updateUser(emailToUpdate, updatedUser);

    // Revoke active sessions if credentials or role privileges changed (except self password edit to keep active session if desired, though rotating revokes stale sessions)
    if ((passwordChanged || roleChanged) && emailToUpdate !== actor.toLowerCase()) {
      await deleteSessionsByEmail(emailToUpdate);
    }

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
      return res
        .status(400)
        .json({ error: 'Lockout Guard: You cannot delete your own active Admin account.' });
    }

    await deleteSessionsByEmail(emailToDelete);
    await deleteUser(emailToDelete);
    await addLog(actor, 'DELETE_USER', `Deleted user account: ${emailToDelete}`);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

function sanitizeSpaceForClient(s: SpaceConfig, isAdmin: boolean): SpaceConfig {
  const hasServiceAccount = !!(s.serviceAccountJson && s.serviceAccountJson.trim() !== '');
  return {
    id: s.id,
    name: s.name,
    domain: s.domain,
    adminEmail: s.adminEmail,
    serviceAccountEmail: s.serviceAccountEmail,
    hasServiceAccount,
    autoApproval: s.autoApproval,
    groupPolicies: s.groupPolicies,
    ...(isAdmin ? { webhookUrl: s.webhookUrl } : {})
  };
}

// 2.7. Spaces CRUD Endpoints
app.get('/api/spaces', requireAuth, async (req, res) => {
  try {
    const spaces = await getSpaces();
    const user = (req as any).user as User;
    const isAdmin = user.role === 'ADMIN';
    res.json(spaces.map((s) => sanitizeSpaceForClient(s, isAdmin)));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/spaces', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const {
      name,
      domain,
      adminEmail,
      serviceAccountJson,
      serviceAccountEmail,
      autoApproval,
      groupPolicies,
      webhookUrl
    } = req.body;

    if (!name || !domain || !adminEmail) {
      return res.status(400).json({ error: 'Name, Domain, and Admin Email are required.' });
    }

    if (serviceAccountJson) {
      validateOptionalCredentialsJson(serviceAccountJson);
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
    clearGoogleTokenCache();
    await addLog(actor, 'CREATE_SPACE', `Created space '${newSpace.name}' for domain '${newSpace.domain}'`);
    broadcastEvent('CONFIG_UPDATED');
    res.json({ success: true, space: sanitizeSpaceForClient(newSpace, true) });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.put('/api/spaces/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const { id } = req.params;
    const {
      name,
      domain,
      adminEmail,
      serviceAccountJson,
      serviceAccountEmail,
      autoApproval,
      groupPolicies,
      webhookUrl
    } = req.body;

    if (!name || !domain || !adminEmail) {
      return res.status(400).json({ error: 'Name, Domain, and Admin Email are required.' });
    }

    if (serviceAccountJson) {
      validateOptionalCredentialsJson(serviceAccountJson);
    }

    const existingSpaces = await getSpaces();
    const existingSpace = existingSpaces.find((s) => s.id === id);

    const resolvedSaJson =
      serviceAccountJson !== undefined
        ? serviceAccountJson.trim() !== ''
          ? serviceAccountJson
          : undefined
        : existingSpace?.serviceAccountJson;

    const updatedSpace: SpaceConfig = {
      id,
      name: name.trim(),
      domain: domain.trim().toLowerCase(),
      adminEmail: adminEmail.trim().toLowerCase(),
      serviceAccountJson: resolvedSaJson,
      serviceAccountEmail: serviceAccountEmail || undefined,
      autoApproval: !!autoApproval,
      groupPolicies: groupPolicies || [],
      webhookUrl: webhookUrl || undefined
    };

    await saveSpace(updatedSpace);
    clearGoogleTokenCache();
    await addLog(actor, 'UPDATE_SPACE', `Updated space '${updatedSpace.name}' config.`);
    broadcastEvent('CONFIG_UPDATED');
    res.json({ success: true, space: sanitizeSpaceForClient(updatedSpace, true) });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.delete('/api/spaces/:id', requireAuth, requireRole(['ADMIN']), async (req, res) => {
  try {
    const actor = ((req as any).user as User).email;
    const { id } = req.params;

    await deleteSpace(id);
    clearGoogleTokenCache();
    await addLog(actor, 'DELETE_SPACE', `Deleted space with ID ${id}`);
    broadcastEvent('CONFIG_UPDATED');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 3. Groups Endpoints
app.get('/api/groups', requireAuth, async (_req, res) => {
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
    const filtered = requests.filter((r) => {
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

  let space = spaces.find((s) =>
    (s.groupPolicies || []).some((p) => p.groupEmail.toLowerCase().trim() === normalizedGroupEmail)
  );

  if (!space) {
    const domain = groupEmail.split('@')[1]?.toLowerCase();
    space = spaces.find((s) => s.domain.toLowerCase() === domain);
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

const CreateJitRequestSchema = z.object({
  groupEmail: z.string().trim().email('Invalid group email address.'),
  groupName: z
    .string()
    .trim()
    .min(1, 'Group name is required.')
    .max(200, 'Group name is too long.'),
  justification: z
    .string()
    .trim()
    .min(3, 'Justification must be at least 3 characters.')
    .max(2000, 'Justification cannot exceed 2000 characters.'),
  durationMinutes: z.coerce
    .number()
    .int('Duration must be a whole number of minutes.')
    .min(5, 'Duration must be at least 5 minutes.')
    .max(240, 'Duration cannot exceed 240 minutes (4 hours).'),
  ticketId: z
    .string()
    .trim()
    .max(64, 'Ticket ID cannot exceed 64 characters.')
    .regex(/^[A-Za-z0-9_#\-/:.\s]*$/, 'Ticket ID contains invalid characters.')
    .optional(),
  isBreakGlass: z.boolean().optional(),
  spaceId: z.string().trim().optional()
});

app.post(
  '/api/requests',
  apiLimiter,
  requireAuth,
  requireRole(['REQUESTER', 'APPROVER', 'ADMIN']),
  async (req, res) => {
    try {
      const parsedBody = CreateJitRequestSchema.safeParse(req.body);
      if (!parsedBody.success) {
        const firstIssue = parsedBody.error.issues[0];
        return res
          .status(400)
          .json({ error: firstIssue ? firstIssue.message : 'Invalid request payload.' });
      }

      const {
        groupEmail,
        groupName,
        justification,
        durationMinutes,
        ticketId: rawTicketId,
        isBreakGlass,
        spaceId
      } = parsedBody.data;
      const cleanTicketId = rawTicketId && rawTicketId.trim() !== '' ? rawTicketId.trim() : undefined;

      const user = (req as any).user as User;
      const requesterEmail = user.email;

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

      const policy = resolvedSettings.groupPolicies.find(
        (p) => p.groupEmail.toLowerCase() === groupEmail.toLowerCase()
      );
      if (policy && policy.requiredAttributes && policy.requiredAttributes.length > 0) {
        const userAttrs = user.attributes || [];
        const missingAttributes = policy.requiredAttributes.filter(
          (attr) => !userAttrs.includes(attr)
        );
        if (missingAttributes.length > 0) {
          return res.status(403).json({
            error: `Access Denied. Membership in this group requires authorization tags: ${missingAttributes.join(', ')}`
          });
        }
      }

      const maxAllowedDuration = policy?.maxDurationMinutes || 240;
      if (!isBreakGlass && durationMinutes > maxAllowedDuration) {
        return res.status(400).json({
          error: `Requested duration (${durationMinutes}m) exceeds policy maximum of ${maxAllowedDuration} minutes for this group.`
        });
      }

      // Emergency Break-Glass Elevation Path
      if (isBreakGlass) {
        if (!policy?.allowBreakGlass) {
          return res.status(403).json({
            error: 'Emergency break-glass elevation is not permitted by policy for this group.'
          });
        }
        const canBreakGlass =
          user.role === 'ADMIN' || (user.attributes || []).includes('oncall');
        if (!canBreakGlass) {
          return res.status(403).json({
            error: "Emergency break-glass requires the 'oncall' attribute or ADMIN role."
          });
        }
        if (!cleanTicketId || cleanTicketId.length < 3) {
          return res.status(400).json({
            error: 'An incident or ticket ID (e.g. INC-1234) is mandatory for break-glass elevation.'
          });
        }

        const bgDuration = Math.min(durationMinutes, 30);
        const nowIso = new Date().toISOString();

        await addGroupMember(groupEmail, requesterEmail);

        const bgRequest: JitRequest = {
          id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          requesterEmail,
          groupEmail,
          groupName,
          justification,
          ticketId: cleanTicketId,
          isBreakGlass: true,
          durationMinutes: bgDuration,
          requestedAt: nowIso,
          status: 'ACTIVE',
          approverEmail: 'SYSTEM (Break-Glass)',
          approvedAt: nowIso,
          activatedAt: nowIso,
          expiresAt: new Date(Date.now() + bgDuration * 60000).toISOString(),
          spaceId: spaceId || resolvedSettings.spaceId
        };

        await saveRequest(bgRequest);
        await addLog(
          requesterEmail,
          'BREAK_GLASS_JIT',
          `EMERGENCY BREAK-GLASS activated for ${groupName} (${bgDuration}m, Ticket: ${cleanTicketId}, Space: ${resolvedSettings.spaceName}). Reason: ${justification}`
        );

        await sendNotification(groupEmail, {
          title: '🚨 EMERGENCY BREAK-GLASS ACTIVATED',
          message: `On-call responder ${requesterEmail} invoked emergency break-glass access to ${groupName} (${resolvedSettings.spaceName}) under incident ${cleanTicketId}.`,
          requestDetails: {
            id: bgRequest.id,
            requesterEmail,
            groupEmail,
            durationMinutes: bgDuration,
            justification,
            ticketId: cleanTicketId,
            isBreakGlass: true,
            status: 'ACTIVE'
          }
        });

        broadcastEvent('REQUEST_CREATED', { requestId: bgRequest.id, isBreakGlass: true });
        return res.json({ success: true, request: bgRequest });
      }

      const requiredApprovals =
        policy?.requiredApprovals && policy.requiredApprovals >= 2 ? 2 : 1;

      const newRequest: JitRequest = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        requesterEmail,
        groupEmail,
        groupName,
        justification,
        ticketId: cleanTicketId,
        durationMinutes,
        requestedAt: new Date().toISOString(),
        status: 'PENDING',
        approvals: [],
        requiredApprovals,
        spaceId: spaceId || resolvedSettings.spaceId
      };

      await addLog(
        requesterEmail,
        'REQUEST_JIT',
        `Requested temporary membership in ${groupName} for ${durationMinutes}m${cleanTicketId ? ` [${cleanTicketId}]` : ''} (Space: ${resolvedSettings.spaceName}). Reason: ${justification}`
      );

      const isAutoApproved = resolvedSettings.autoApproval || (policy && !!policy.autoApproval);
      if (isAutoApproved) {
        try {
          await addGroupMember(groupEmail, requesterEmail);

          newRequest.status = 'ACTIVE';
          newRequest.activatedAt = new Date().toISOString();
          newRequest.expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString();
          newRequest.approverEmail = 'SYSTEM (Auto-Approved)';
          newRequest.approvedAt = new Date().toISOString();

          await saveRequest(newRequest);
          await addLog(
            'SYSTEM',
            'ACTIVATE_JIT',
            `Added ${requesterEmail} to group ${groupName} (Auto-Approved, Space: ${resolvedSettings.spaceName}). Expiry: ${newRequest.expiresAt}`
          );

          await sendNotification(groupEmail, {
            title: 'JIT Request APPROVED (Auto-Approved)',
            message: `JIT request for ${requesterEmail} to join group ${groupName} in Space ${resolvedSettings.spaceName} was automatically approved and activated.`,
            requestDetails: {
              id: newRequest.id,
              requesterEmail,
              groupEmail,
              durationMinutes,
              justification,
              ticketId: cleanTicketId,
              status: 'ACTIVE'
            }
          });

          broadcastEvent('REQUEST_CREATED', { requestId: newRequest.id });
          return res.json({ success: true, request: newRequest });
        } catch (err) {
          newRequest.status = 'PENDING';
          await saveRequest(newRequest);
          await addLog(
            'SYSTEM',
            'ACTIVATE_ERROR',
            `Failed adding ${requesterEmail} to group ${groupName}: ${(err as Error).message}`
          );

          await sendNotification(groupEmail, {
            title: 'JIT Request PENDING (Auto-Activation Failed)',
            message: `JIT request for ${requesterEmail} to join group ${groupName} failed automatic provisioning: ${(err as Error).message}`,
            requestDetails: {
              id: newRequest.id,
              requesterEmail,
              groupEmail,
              durationMinutes,
              justification,
              ticketId: cleanTicketId,
              status: 'PENDING'
            }
          });

          broadcastEvent('REQUEST_CREATED', { requestId: newRequest.id });
          return res.json({
            success: false,
            error: `Auto-approval failed to provision group membership: ${(err as Error).message}`,
            request: newRequest
          });
        }
      } else {
        await saveRequest(newRequest);

        await sendNotification(groupEmail, {
          title: 'JIT Request PENDING',
          message: `JIT request for ${requesterEmail} to join group ${groupName} (Space: ${resolvedSettings.spaceName}) is pending peer approval (${requiredApprovals} required).`,
          requestDetails: {
            id: newRequest.id,
            requesterEmail,
            groupEmail,
            durationMinutes,
            justification,
            ticketId: cleanTicketId,
            status: 'PENDING'
          }
        });

        broadcastEvent('REQUEST_CREATED', { requestId: newRequest.id });
        res.json({ success: true, request: newRequest });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

const ReviewActionSchema = z.object({
  reviewNote: z.string().trim().max(500, 'Review note cannot exceed 500 characters.').optional()
});

app.post(
  '/api/requests/:id/approve',
  apiLimiter,
  requireAuth,
  requireRole(['APPROVER', 'ADMIN']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = ReviewActionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review input.' });
      }
      const cleanNote =
        parsed.data.reviewNote && parsed.data.reviewNote.trim() !== ''
          ? parsed.data.reviewNote.trim()
          : undefined;

      const approver = (req as any).user as User;
      const approverEmail = approver.email;
      const requests = await getRequests();
      const request = requests.find((r) => r.id === id);

      if (!request) {
        return res.status(404).json({ error: 'Request not found.' });
      }

      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: `Cannot approve request in ${request.status} status.` });
      }

      if (request.requesterEmail.toLowerCase() === approverEmail.toLowerCase()) {
        return res.status(400).json({
          error: 'Self-approval is not allowed. An independent peer must authorize your request.'
        });
      }

      const targetSpace = request.spaceId || 'global';
      if (
        approver.role !== 'ADMIN' &&
        !(approver.assignedSpaces || []).includes(targetSpace)
      ) {
        return res.status(403).json({
          error: `Forbidden. You are not authorized to approve requests for space '${targetSpace}'.`
        });
      }

      const existingApprovals: JitApprovalEntry[] = request.approvals || [];
      if (
        existingApprovals.some(
          (a) => a.approverEmail.toLowerCase() === approverEmail.toLowerCase()
        )
      ) {
        return res.status(400).json({
          error: 'You have already recorded your approval. Another independent peer must complete the quorum.'
        });
      }

      const nowIso = new Date().toISOString();
      const updatedApprovals: JitApprovalEntry[] = [
        ...existingApprovals,
        { approverEmail, approvedAt: nowIso, ...(cleanNote ? { note: cleanNote } : {}) }
      ];
      const requiredCount =
        request.requiredApprovals && request.requiredApprovals >= 2
          ? request.requiredApprovals
          : 1;

      // Quorum not yet satisfied (e.g. 1 of 2 peer approvals recorded)
      if (updatedApprovals.length < requiredCount) {
        const partialRequest: JitRequest = {
          ...request,
          approvals: updatedApprovals,
          reviewNote: cleanNote || request.reviewNote
        };
        await updateRequest(partialRequest);
        await addLog(
          approverEmail,
          'APPROVE_JIT',
          `Recorded peer approval (${updatedApprovals.length}/${requiredCount}) on ${request.id} for ${request.requesterEmail}${cleanNote ? ` — Note: ${cleanNote}` : ''}`
        );
        await sendNotification(request.groupEmail, {
          title: `JIT Request Quorum Progress (${updatedApprovals.length}/${requiredCount})`,
          message: `${approverEmail} recorded approval ${updatedApprovals.length} of ${requiredCount} for ${request.requesterEmail} (${request.groupName}). Awaiting one additional peer approver.`,
          requestDetails: {
            id: request.id,
            requesterEmail: request.requesterEmail,
            groupEmail: request.groupEmail,
            durationMinutes: request.durationMinutes,
            justification: request.justification,
            ticketId: request.ticketId,
            reviewNote: cleanNote,
            status: 'PENDING'
          }
        });
        broadcastEvent('REQUEST_UPDATED', { requestId: request.id });
        return res.json({ success: true, quorumPending: true, request: partialRequest });
      }

      try {
        await addGroupMember(request.groupEmail, request.requesterEmail);

        const allApproversLabel = updatedApprovals.map((a) => a.approverEmail).join(', ');
        const updatedRequest: JitRequest = {
          ...request,
          status: 'ACTIVE',
          approverEmail: allApproversLabel,
          approvedAt: nowIso,
          reviewNote: cleanNote || request.reviewNote,
          approvals: updatedApprovals,
          activatedAt: nowIso,
          expiresAt: new Date(Date.now() + request.durationMinutes * 60000).toISOString()
        };

        await updateRequest(updatedRequest);
        await addLog(
          approverEmail,
          'APPROVE_JIT',
          `Approved JIT request ${request.id} for ${request.requesterEmail}${cleanNote ? ` — Note: ${cleanNote}` : ''}`
        );
        await addLog(
          'SYSTEM',
          'ACTIVATE_JIT',
          `Added ${request.requesterEmail} to group ${request.groupName}. Expiry: ${updatedRequest.expiresAt}`
        );

        await sendNotification(request.groupEmail, {
          title: 'JIT Request APPROVED',
          message: `JIT request for ${request.requesterEmail} to join group ${request.groupName} has been approved by ${allApproversLabel} and is now active.`,
          requestDetails: {
            id: request.id,
            requesterEmail: request.requesterEmail,
            groupEmail: request.groupEmail,
            durationMinutes: request.durationMinutes,
            justification: request.justification,
            ticketId: request.ticketId,
            reviewNote: cleanNote || request.reviewNote,
            status: 'ACTIVE'
          }
        });

        broadcastEvent('REQUEST_UPDATED', { requestId: request.id });
        res.json({ success: true, request: updatedRequest });
      } catch (err) {
        await addLog(
          approverEmail,
          'APPROVE_ERROR',
          `Failed adding member for request ${request.id}: ${(err as Error).message}`
        );
        res
          .status(500)
          .json({ error: `Provisioning group membership failed: ${(err as Error).message}` });
      }
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

app.post(
  '/api/requests/:id/deny',
  apiLimiter,
  requireAuth,
  requireRole(['APPROVER', 'ADMIN']),
  async (req, res) => {
    try {
      const { id } = req.params;
      const parsed = ReviewActionSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid review input.' });
      }
      const cleanNote =
        parsed.data.reviewNote && parsed.data.reviewNote.trim() !== ''
          ? parsed.data.reviewNote.trim()
          : undefined;

      const approver = (req as any).user as User;
      const approverEmail = approver.email;
      const requests = await getRequests();
      const request = requests.find((r) => r.id === id);

      if (!request) {
        return res.status(404).json({ error: 'Request not found.' });
      }

      if (request.status !== 'PENDING') {
        return res.status(400).json({ error: `Cannot deny request in ${request.status} status.` });
      }

      if (request.requesterEmail.toLowerCase() === approverEmail.toLowerCase()) {
        return res.status(400).json({ error: 'Self-denial via peer approval is not allowed.' });
      }

      const targetSpace = request.spaceId || 'global';
      if (
        approver.role !== 'ADMIN' &&
        !(approver.assignedSpaces || []).includes(targetSpace)
      ) {
        return res.status(403).json({
          error: `Forbidden. You are not authorized to deny requests for space '${targetSpace}'.`
        });
      }

      const updatedRequest: JitRequest = {
        ...request,
        status: 'DENIED',
        approverEmail,
        approvedAt: new Date().toISOString(),
        reviewNote: cleanNote
      };

      await updateRequest(updatedRequest);
      await addLog(
        approverEmail,
        'DENY_JIT',
        `Denied membership request ${request.id} for ${request.requesterEmail}${cleanNote ? ` — Reason: ${cleanNote}` : ''}`
      );

      await sendNotification(request.groupEmail, {
        title: 'JIT Request DENIED',
        message: `JIT request for ${request.requesterEmail} to join group ${request.groupName} was rejected by ${approverEmail}.`,
        requestDetails: {
          id: request.id,
          requesterEmail: request.requesterEmail,
          groupEmail: request.groupEmail,
          durationMinutes: request.durationMinutes,
          justification: request.justification,
          ticketId: request.ticketId,
          reviewNote: cleanNote,
          status: 'DENIED'
        }
      });

      broadcastEvent('REQUEST_UPDATED', { requestId: request.id });
      res.json({ success: true, request: updatedRequest });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  }
);

// Extend Active JIT Session (+30 minutes, max 2 extensions, within policy maxDurationMinutes)
app.post('/api/requests/:id/extend', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user as User;
    const actor = user.email;
    const requests = await getRequests();
    const request = requests.find((r) => r.id === id);

    if (!request) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    if (request.status !== 'ACTIVE' || !request.expiresAt) {
      return res.status(400).json({ error: 'Only active sessions can be extended.' });
    }
    if (request.isBreakGlass) {
      return res.status(400).json({
        error: 'Emergency break-glass sessions cannot be extended. Submit a standard peer-reviewed request.'
      });
    }

    const isOwner = request.requesterEmail.toLowerCase() === actor.toLowerCase();
    if (!isOwner && user.role !== 'ADMIN') {
      return res.status(403).json({
        error: 'Only the session owner or an Administrator can extend an active session.'
      });
    }

    const currentExtensions = request.extendedCount || 0;
    if (currentExtensions >= 2) {
      return res.status(400).json({
        error: 'Maximum of 2 session extensions (+60m total) reached for this elevation.'
      });
    }

    const resolvedSettings = await resolveSpaceSettings(request.groupEmail);
    const policy = resolvedSettings.groupPolicies.find(
      (p) => p.groupEmail.toLowerCase() === request.groupEmail.toLowerCase()
    );
    const maxAllowed = policy?.maxDurationMinutes || 240;

    if (request.durationMinutes + 30 > maxAllowed) {
      return res.status(400).json({
        error: `Cannot extend beyond policy maximum duration of ${maxAllowed} minutes.`
      });
    }

    const newExpiresAt = new Date(
      Math.max(Date.now(), new Date(request.expiresAt).getTime()) + 30 * 60000
    ).toISOString();

    const updatedRequest: JitRequest = {
      ...request,
      durationMinutes: request.durationMinutes + 30,
      expiresAt: newExpiresAt,
      extendedCount: currentExtensions + 1
    };

    await updateRequest(updatedRequest);
    await addLog(
      actor,
      'EXTEND_JIT',
      `Extended active JIT session ${request.id} for ${request.groupName} by +30m (New expiry: ${newExpiresAt})`
    );

    await sendNotification(request.groupEmail, {
      title: 'JIT Session EXTENDED (+30m)',
      message: `${actor} extended active JIT membership in ${request.groupName} by 30 minutes.`,
      requestDetails: {
        id: request.id,
        requesterEmail: request.requesterEmail,
        groupEmail: request.groupEmail,
        durationMinutes: updatedRequest.durationMinutes,
        justification: request.justification,
        ticketId: request.ticketId,
        status: 'ACTIVE'
      }
    });

    broadcastEvent('REQUEST_UPDATED', { requestId: request.id });
    res.json({ success: true, request: updatedRequest });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/requests/:id/revoke', apiLimiter, requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = (req as any).user as User;
    const actor = user.email;
    const requests = await getRequests();
    const request = requests.find((r) => r.id === id);

    if (!request) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    if (request.status !== 'ACTIVE') {
      return res.status(400).json({ error: `Cannot revoke request in ${request.status} status.` });
    }

    if (user.role === 'AUDITOR') {
      return res.status(403).json({ error: 'Forbidden. Auditors are not authorized to revoke access.' });
    }

    if (
      user.role === 'REQUESTER' &&
      request.requesterEmail.toLowerCase() !== actor.toLowerCase()
    ) {
      return res
        .status(403)
        .json({ error: 'Forbidden. Requesters are only allowed to revoke their own sessions.' });
    }

    const targetSpace = request.spaceId || 'global';
    if (
      user.role === 'APPROVER' &&
      request.requesterEmail.toLowerCase() !== actor.toLowerCase() &&
      !(user.assignedSpaces || []).includes(targetSpace)
    ) {
      return res.status(403).json({
        error: `Forbidden. You are not authorized to revoke requests in space '${targetSpace}'.`
      });
    }

    try {
      await removeGroupMember(request.groupEmail, request.requesterEmail);

      const updatedRequest: JitRequest = {
        ...request,
        status: 'REVOKED',
        revokedAt: new Date().toISOString()
      };

      await updateRequest(updatedRequest);
      await addLog(
        actor,
        'REVOKE_JIT',
        `Manually removed ${request.requesterEmail} from group ${request.groupName}`
      );

      await sendNotification(request.groupEmail, {
        title: 'JIT Request REVOKED',
        message: `JIT access for ${request.requesterEmail} to group ${request.groupName} was manually revoked by ${actor}.`,
        requestDetails: {
          id: request.id,
          requesterEmail: request.requesterEmail,
          groupEmail: request.groupEmail,
          durationMinutes: request.durationMinutes,
          justification: request.justification,
          ticketId: request.ticketId,
          isBreakGlass: request.isBreakGlass,
          status: 'REVOKED'
        }
      });

      broadcastEvent('REQUEST_UPDATED', { requestId: request.id });
      res.json({ success: true, request: updatedRequest });
    } catch (err) {
      res.status(500).json({ error: `Revocation failed: ${(err as Error).message}` });
    }
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 4.5. Cloud Scheduler / Internal Expiration Trigger Endpoint (Cloud Run scale-to-zero safe)
app.post('/api/internal/cron/expire', apiLimiter, async (req, res) => {
  const configuredSecret = (process.env.CRON_SECRET || '').trim();
  const providedSecret = (
    (req.headers['x-cron-secret'] as string) ||
    (req.headers['authorization']?.startsWith('Bearer ')
      ? req.headers['authorization'].substring(7)
      : '') ||
    ''
  ).trim();

  if (configuredSecret && providedSecret) {
    const bufA = Buffer.from(configuredSecret, 'utf-8');
    const bufB = Buffer.from(providedSecret, 'utf-8');
    if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
      try {
        const revokedCount = await checkExpiredRequests();
        return res.json({ success: true, revokedCount, timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: (err as Error).message });
      }
    }
  }

  return requireAuth(req, res, () => {
    return requireRole(['ADMIN'])(req, res, async () => {
      try {
        const revokedCount = await checkExpiredRequests();
        return res.json({ success: true, revokedCount, timestamp: new Date().toISOString() });
      } catch (err) {
        return res.status(500).json({ error: (err as Error).message });
      }
    });
  });
});

// 5. Logs Endpoints
app.get('/api/logs', requireAuth, requireRole(['ADMIN', 'AUDITOR']), async (_req, res) => {
  try {
    const logs = await getLogs();
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

function sanitizeCsvField(value: string): string {
  const str = String(value ?? '');
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${formulaSafe.replace(/"/g, '""')}"`;
}

app.get('/api/logs/export', requireAuth, requireRole(['ADMIN', 'AUDITOR']), async (_req, res) => {
  try {
    const logs = await getAllLogs();

    const csvRows = [['ID', 'Timestamp', 'Actor', 'Action', 'Details']];
    for (const log of logs) {
      csvRows.push([log.id, log.timestamp, log.actor, log.action, log.details]);
    }
    const csvContent = csvRows.map((row) => row.map(sanitizeCsvField).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=gws-jit-audit-logs-${Date.now()}.csv`
    );
    res.status(200).send(csvContent);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// 6. Documentation Endpoints
app.get('/api/docs', requireAuth, async (req, res) => {
  try {
    const fs = await import('fs/promises');
    const type = req.query.type === 'manual' ? 'USER_MANUAL.md' : 'README.md';

    let docPath = '';
    const possiblePaths = [
      path.join(process.cwd(), type),
      path.join(process.cwd(), '..', type),
      path.join(__dirname, '..', '..', type),
      path.join(__dirname, '..', type)
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        docPath = p;
        break;
      } catch {
        // Check next candidate path
      }
    }

    if (!docPath) {
      throw new Error(`File ${type} not found in any standard location.`);
    }

    const content = await fs.readFile(docPath, 'utf8');
    res.json({ content });
  } catch (error) {
    logStructured('ERROR', 'DOCS', 'Documentation read error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to read system documentation.' });
  }
});

// Serve frontend static assets in production
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

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

const server = app.listen(Number(PORT), '0.0.0.0', async () => {
  logStructured('INFO', 'SERVER', `Group JIT Server listening on http://0.0.0.0:${PORT}`);
  startScheduler(10000);

  if (process.env.AUTH_MODE !== 'IAP') {
    try {
      const users = await getUsers();
      const user = users.find((u) => u.email.toLowerCase() === 'superadmin@company.com');
      if (user && verifyPassword('password', user.password || '')) {
        logStructured(
          'WARNING',
          'SECURITY',
          "Default bootstrap password detected on 'superadmin@company.com'. Rotate immediately before production use."
        );
      }
    } catch (err) {
      logStructured('ERROR', 'SECURITY', 'Default credentials check failed', {
        error: (err as Error).message
      });
    }
  }
});

function gracefulShutdown(signal: string) {
  logStructured('INFO', 'SHUTDOWN', `Received ${signal}. Draining connections...`);

  server.close(() => {
    logStructured('INFO', 'SHUTDOWN', 'HTTP server closed.');
  });

  stopScheduler();
  clearInterval(sessionCleanupInterval);

  setTimeout(() => {
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
