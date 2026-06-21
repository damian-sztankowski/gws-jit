import * as fs from 'fs/promises';
import * as path from 'path';
import { Firestore } from '@google-cloud/firestore';
import crypto from 'crypto';
import { JitRequest, AppConfig, AuditLog, User, SpaceConfig } from './types.js';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 210000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  return `v2:${iterations}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  
  if (parts[0] === 'v2') {
    if (parts.length !== 4) return false;
    const [, iterationsStr, salt, hash] = parts;
    const iterations = parseInt(iterationsStr, 10);
    const verifyHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }
  
  if (parts.length === 2) {
    const [salt, hash] = parts;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  }
  
  return password === storedHash; // Fallback for legacy plain-text passwords
}

const isFirestore = process.env.DATABASE_ENGINE === 'FIRESTORE';
const firestore = isFirestore ? new Firestore({ ignoreUndefinedProperties: true }) : null;

interface DatabaseSchema {
  requests: JitRequest[];
  config: AppConfig;
  logs: AuditLog[];
  users: User[];
}

const DB_FILE = path.join(process.cwd(), 'db.json');

const DEFAULT_DB: DatabaseSchema = {
  requests: [
    {
      id: "req_1",
      requesterEmail: "bob@company.com",
      groupEmail: "gws-user-admins@company.com",
      groupName: "GWS User Admins Group",
      justification: "Need to create temporary contractor accounts for onboarding",
      durationMinutes: 60,
      requestedAt: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
      status: "EXPIRED",
      approverEmail: "alice@company.com",
      approvedAt: new Date(Date.now() - 3600000 * 24 + 300000).toISOString(),
      activatedAt: new Date(Date.now() - 3600000 * 24 + 300000).toISOString(),
      expiresAt: new Date(Date.now() - 3600000 * 24 + 300000 + 3600000).toISOString()
    },
    {
      id: "req_2",
      requesterEmail: "charlie@company.com",
      groupEmail: "gws-super-admins@company.com",
      groupName: "GWS Super Admins Group",
      justification: "Emergency audit log export",
      durationMinutes: 30,
      requestedAt: new Date(Date.now() - 3600000 * 2).toISOString(), // 2 hours ago
      status: "DENIED",
      approverEmail: "alice@company.com",
      approvedAt: new Date(Date.now() - 3600000 * 2 + 120000).toISOString()
    }
  ],
  config: {
    mode: "MOCK",
    domain: "company.com",
    serviceAccountEmail: "",
    autoApproval: false,
    spaces: [],
    eligibleAttributes: ["oncall", "cdt", "security", "readonly"],
    attestationIntervalDays: 90,
    groupPolicies: [
      {
        groupEmail: "gws-super-admins@company.com",
        requiredAttributes: ["security"],
        lastCertifiedAt: new Date().toISOString(),
        lastCertifiedBy: "system",
        attestationDueAt: new Date(Date.now() + 90 * 24 * 3600000).toISOString()
      },
      {
        groupEmail: "gws-user-admins@company.com",
        requiredAttributes: ["oncall"],
        lastCertifiedAt: new Date().toISOString(),
        lastCertifiedBy: "system",
        attestationDueAt: new Date(Date.now() + 90 * 24 * 3600000).toISOString()
      },
      {
        groupEmail: "gws-billing-leads@company.com",
        requiredAttributes: ["readonly"],
        lastCertifiedAt: new Date().toISOString(),
        lastCertifiedBy: "system",
        attestationDueAt: new Date(Date.now() + 90 * 24 * 3600000).toISOString()
      },
      {
        groupEmail: "gws-security-ops@company.com",
        requiredAttributes: ["cdt", "security"],
        lastCertifiedAt: new Date().toISOString(),
        lastCertifiedBy: "system",
        attestationDueAt: new Date(Date.now() + 90 * 24 * 3600000).toISOString()
      }
    ]
  },
  logs: [
    {
      id: "log_1",
      timestamp: new Date(Date.now() - 3600000 * 24).toISOString(),
      actor: "bob@company.com",
      action: "REQUEST_JIT",
      details: "Requested GWS User Admins Group membership for 60m. Reason: Need to create temporary contractor accounts"
    },
    {
      id: "log_2",
      timestamp: new Date(Date.now() - 3600000 * 24 + 300000).toISOString(),
      actor: "alice@company.com",
      action: "APPROVE_JIT",
      details: "Approved request req_1 for bob@company.com"
    },
    {
      id: "log_3",
      timestamp: new Date(Date.now() - 3600000 * 23).toISOString(),
      actor: "SYSTEM",
      action: "REVOKE_JIT",
      details: "Automatically removed bob@company.com from GWS User Admins Group (Expired)"
    }
  ],
  users: [
    {
      email: "superadmin@company.com",
      name: "Super Admin",
      role: "ADMIN",
      password: "password",
      attributes: ["oncall", "cdt", "security", "readonly"],
      assignedSpaces: ["global"]
    }
  ]
};

let initPromise: Promise<DatabaseSchema> | null = null;

export async function initDb(): Promise<DatabaseSchema> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    if (isFirestore && firestore) {
      try {
        // Seed config if not present
        const configDoc = await firestore.collection('config').doc('system').get();
        if (!configDoc.exists) {
          console.log("[DB] Seeding default configuration to Firestore...");
          await firestore.collection('config').doc('system').set(DEFAULT_DB.config);
          console.log("[DB] Seeding default configuration complete.");
        } else {
          console.log("[DB] Firestore configuration already exists.");
        }
        
        // Seed users if not present
        const usersSnap = await firestore.collection('users').limit(1).get();
        if (usersSnap.empty) {
          console.log("[DB] Seeding default users to Firestore...");
          for (const user of DEFAULT_DB.users) {
            const seededUser = {
              ...user,
              password: hashPassword(user.password || '')
            };
            await firestore.collection('users').doc(user.email.toLowerCase()).set(seededUser);
          }
          console.log("[DB] Seeding default users complete.");
        } else {
          console.log("[DB] Firestore users already exist.");
        }
      } catch (err) {
        console.error("[DB] Failed to initialize/seed Firestore:", err);
      }
      return DEFAULT_DB;
    }

    try {
      const data = await fs.readFile(DB_FILE, 'utf-8');
      const parsed = JSON.parse(data) as any;
      let modified = false;

      // Migrate old config schemas (convert eligibleGroupEmails to groupPolicies)
      if (!parsed.config.groupPolicies) {
        const groupEmails = parsed.config.eligibleGroupEmails || [];
        parsed.config.groupPolicies = groupEmails.map((email: string) => ({
          groupEmail: email,
          requiredAttributes: []
        }));
        modified = true;
      }

      // 1. Migrate Global eligibleAttributes
      if (!parsed.config.eligibleAttributes) {
        parsed.config.eligibleAttributes = ["oncall", "cdt", "security", "readonly"];
        modified = true;
      }

      // 1.5 Migrate Global serviceAccountEmail
      if (parsed.config.serviceAccountEmail === undefined) {
        parsed.config.serviceAccountEmail = "";
        modified = true;
      }

      // 2. Migrate Global groupPolicies
      if (parsed.config.groupPolicies) {
        parsed.config.groupPolicies = parsed.config.groupPolicies.map((p: any) => {
          if (!p.requiredAttributes) {
            const requiredAttributes: string[] = [];
            if (p.requiresOncall) requiredAttributes.push("oncall");
            if (p.requiresCdt) requiredAttributes.push("cdt");
            if (p.requiresSecurity) requiredAttributes.push("security");
            if (p.requiresReadonly) requiredAttributes.push("readonly");
            modified = true;
            const { requiresOncall, requiresCdt, requiresSecurity, requiresReadonly, ...rest } = p;
            return { ...rest, requiredAttributes };
          }
          return p;
        });
      }

      // 3. Migrate Space-specific groupPolicies
      if (parsed.config.spaces) {
        parsed.config.spaces = parsed.config.spaces.map((s: any) => {
          if (s.serviceAccountEmail === undefined) {
            s.serviceAccountEmail = "";
            modified = true;
          }
          if (s.groupPolicies) {
            s.groupPolicies = s.groupPolicies.map((p: any) => {
              if (!p.requiredAttributes) {
                const requiredAttributes: string[] = [];
                if (p.requiresOncall) requiredAttributes.push("oncall");
                if (p.requiresCdt) requiredAttributes.push("cdt");
                if (p.requiresSecurity) requiredAttributes.push("security");
                if (p.requiresReadonly) requiredAttributes.push("readonly");
                modified = true;
                const { requiresOncall, requiresCdt, requiresSecurity, requiresReadonly, ...rest } = p;
                return { ...rest, requiredAttributes };
              }
              return p;
            });
          }
          return s;
        });
      }

      // 3.5 Migrate Attestation Config
      if (parsed.config.attestationIntervalDays === undefined) {
        parsed.config.attestationIntervalDays = 90;
        modified = true;
      }

      const intervalDays = parsed.config.attestationIntervalDays || 90;

      // Migrate Global JIT policy attestation fields
      if (parsed.config.groupPolicies) {
        parsed.config.groupPolicies = parsed.config.groupPolicies.map((p: any) => {
          if (!p.lastCertifiedAt) {
            const now = new Date();
            p.lastCertifiedAt = now.toISOString();
            p.lastCertifiedBy = "system";
            p.attestationDueAt = new Date(now.getTime() + intervalDays * 24 * 3600000).toISOString();
            modified = true;
          }
          return p;
        });
      }

      // Migrate Space JIT policy attestation fields
      if (parsed.config.spaces) {
        parsed.config.spaces = parsed.config.spaces.map((s: any) => {
          if (s.groupPolicies) {
            s.groupPolicies = s.groupPolicies.map((p: any) => {
              if (!p.lastCertifiedAt) {
                const now = new Date();
                p.lastCertifiedAt = now.toISOString();
                p.lastCertifiedBy = "system";
                p.attestationDueAt = new Date(now.getTime() + intervalDays * 24 * 3600000).toISOString();
                modified = true;
              }
              return p;
            });
          }
          return s;
        });
      }

      // Seed users if not present
      if (!parsed.users || parsed.users.length === 0) {
        parsed.users = DEFAULT_DB.users.map(u => ({
          ...u,
          password: hashPassword(u.password || '')
        }));
        modified = true;
      } else {
        // 4. Migrate existing users attributes
        parsed.users = parsed.users.map((u: any) => {
          if (!u.attributes) {
            const attributes: string[] = [];
            if (u.oncall) attributes.push("oncall");
            if (u.cdt) attributes.push("cdt");
            if (u.security) attributes.push("security");
            if (u.readonly) attributes.push("readonly");
            modified = true;
            const { oncall, cdt, security, readonly, ...rest } = u;
            return { ...rest, attributes };
          }
          return u;
        });

        // Ensure at least one admin user exists
        const hasAdmin = parsed.users.some((u: any) => u.role === 'ADMIN');
        if (!hasAdmin) {
          parsed.users.push({
            email: "superadmin@company.com",
            name: "Super Admin",
            role: "ADMIN",
            password: hashPassword("password"),
            attributes: ["oncall", "cdt", "security"],
            assignedSpaces: []
          });
          modified = true;
        }
      }

      if (modified) {
        await fs.writeFile(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
      }
      return parsed as DatabaseSchema;
    } catch (error) {
      // Write default DB if not exists
      await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), 'utf-8');
      return DEFAULT_DB;
    }
  })();
  return initPromise;
}

export async function readDb(): Promise<DatabaseSchema> {
  return initDb();
}

export async function writeDb(data: DatabaseSchema): Promise<void> {
  await fs.writeFile(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function getSpaces(): Promise<SpaceConfig[]> {
  if (isFirestore && firestore) {
    await initDb();
    const snapshot = await firestore.collection('spaces').get();
    return snapshot.docs.map(doc => doc.data() as SpaceConfig);
  }
  const db = await readDb();
  return db.config.spaces || [];
}

export async function saveSpace(space: SpaceConfig): Promise<void> {
  if (isFirestore && firestore) {
    await initDb();
    await firestore.collection('spaces').doc(space.id).set(space);
    return;
  }
  const db = await readDb();
  if (!db.config.spaces) {
    db.config.spaces = [];
  }
  const index = db.config.spaces.findIndex(s => s.id === space.id);
  if (index >= 0) {
    db.config.spaces[index] = space;
  } else {
    db.config.spaces.push(space);
  }
  await writeDb(db);
}

export async function deleteSpace(id: string): Promise<void> {
  if (isFirestore && firestore) {
    await initDb();
    await firestore.collection('spaces').doc(id).delete();
    return;
  }
  const db = await readDb();
  if (db.config.spaces) {
    db.config.spaces = db.config.spaces.filter(s => s.id !== id);
  }
  await writeDb(db);
}

export async function getRequests(): Promise<JitRequest[]> {
  if (isFirestore && firestore) {
    await initDb();
    const snapshot = await firestore.collection('requests').get();
    return snapshot.docs.map(doc => doc.data() as JitRequest);
  }
  const db = await readDb();
  return db.requests;
}

export async function saveRequest(request: JitRequest): Promise<void> {
  if (isFirestore && firestore) {
    await initDb();
    await firestore.collection('requests').doc(request.id).set(request);
    return;
  }
  const db = await readDb();
  db.requests.push(request);
  await writeDb(db);
}

export async function updateRequest(updated: JitRequest): Promise<void> {
  if (isFirestore && firestore) {
    await initDb();
    await firestore.collection('requests').doc(updated.id).set(updated, { merge: true });
    return;
  }
  const db = await readDb();
  db.requests = db.requests.map(r => r.id === updated.id ? updated : r);
  await writeDb(db);
}

export async function getConfig(): Promise<AppConfig> {
  if (isFirestore && firestore) {
    await initDb();
    const doc = await firestore.collection('config').doc('system').get();
    if (!doc.exists) {
      return DEFAULT_DB.config;
    }
    return doc.data() as AppConfig;
  }
  const db = await readDb();
  return db.config;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (isFirestore && firestore) {
    await initDb();
    await firestore.collection('config').doc('system').set(config, { merge: true });
    return;
  }
  const db = await readDb();
  db.config = config;
  await writeDb(db);
}

export async function getLogs(): Promise<AuditLog[]> {
  if (isFirestore && firestore) {
    await initDb();
    const snapshot = await firestore.collection('logs').orderBy('timestamp', 'desc').limit(200).get();
    return snapshot.docs.map(doc => doc.data() as AuditLog);
  }
  const db = await readDb();
  return db.logs;
}

export async function getAllLogs(): Promise<AuditLog[]> {
  if (isFirestore && firestore) {
    await initDb();
    const snapshot = await firestore.collection('logs').orderBy('timestamp', 'desc').get();
    return snapshot.docs.map(doc => doc.data() as AuditLog);
  }
  const db = await readDb();
  return db.logs;
}

export async function addLog(actor: string, action: string, details: string): Promise<void> {
  const newLog: AuditLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    timestamp: new Date().toISOString(),
    actor,
    action,
    details
  };
  if (isFirestore && firestore) {
    await initDb();
    await firestore.collection('logs').doc(newLog.id).set(newLog);
    return;
  }
  const db = await readDb();
  db.logs.unshift(newLog);
  await writeDb(db);
}

export async function getUsers(): Promise<User[]> {
  if (isFirestore && firestore) {
    await initDb();
    const snapshot = await firestore.collection('users').get();
    return snapshot.docs.map(doc => doc.data() as User);
  }
  const db = await readDb();
  return db.users || [];
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const normalizedEmail = email.toLowerCase().trim();
  if (isFirestore && firestore) {
    await initDb();
    const doc = await firestore.collection('users').doc(normalizedEmail).get();
    if (!doc.exists) return undefined;
    return doc.data() as User;
  }
  const db = await readDb();
  return (db.users || []).find(u => u.email.toLowerCase() === normalizedEmail);
}

export async function createUser(user: User): Promise<void> {
  const normalizedEmail = user.email.toLowerCase().trim();
  const cleanedUser = { ...user, email: normalizedEmail };
  if (cleanedUser.password) {
    cleanedUser.password = hashPassword(cleanedUser.password);
  }
  if (isFirestore && firestore) {
    await initDb();
    const docRef = firestore.collection('users').doc(normalizedEmail);
    const doc = await docRef.get();
    if (doc.exists) {
      throw new Error(`User with email ${user.email} already exists.`);
    }
    await docRef.set(cleanedUser);
    return;
  }
  const db = await readDb();
  if (!db.users) db.users = [];
  const exists = db.users.some(u => u.email.toLowerCase() === normalizedEmail);
  if (exists) {
    throw new Error(`User with email ${user.email} already exists.`);
  }
  db.users.push(cleanedUser);
  await writeDb(db);
}

export async function updateUser(email: string, updated: User): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  const cleanedUpdated = { ...updated, email: normalizedEmail };
  if (isFirestore && firestore) {
    await initDb();
    const docRef = firestore.collection('users').doc(normalizedEmail);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`User with email ${email} not found.`);
    }
    const existing = doc.data() as User;
    if (!cleanedUpdated.password) {
      cleanedUpdated.password = existing.password;
    } else if (cleanedUpdated.password !== existing.password) {
      cleanedUpdated.password = hashPassword(cleanedUpdated.password);
    }
    await docRef.set(cleanedUpdated, { merge: true });
    return;
  }
  const db = await readDb();
  let found = false;
  db.users = (db.users || []).map(u => {
    if (u.email.toLowerCase() === normalizedEmail) {
      found = true;
      if (!cleanedUpdated.password) {
        cleanedUpdated.password = u.password;
      } else if (cleanedUpdated.password !== u.password) {
        cleanedUpdated.password = hashPassword(cleanedUpdated.password);
      }
      return cleanedUpdated;
    }
    return u;
  });
  if (!found) {
    throw new Error(`User with email ${email} not found.`);
  }
  await writeDb(db);
}

export async function deleteUser(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();
  if (isFirestore && firestore) {
    await initDb();
    const docRef = firestore.collection('users').doc(normalizedEmail);
    const doc = await docRef.get();
    if (!doc.exists) {
      throw new Error(`User with email ${email} not found.`);
    }
    await docRef.delete();
    return;
  }
  const db = await readDb();
  const initialLength = (db.users || []).length;
  db.users = (db.users || []).filter(u => u.email.toLowerCase() !== normalizedEmail);
  if (db.users.length === initialLength) {
    throw new Error(`User with email ${email} not found.`);
  }
  await writeDb(db);
}
