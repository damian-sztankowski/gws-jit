import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';
import { WorkspaceGroup } from './types.js';
import { getConfig, getSpaces } from './db.js';
import { logStructured } from './events.js';

const MOCK_GROUPS: WorkspaceGroup[] = [
  { email: "gws-super-admins@company.com", name: "GWS Super Admins Group", description: "Provides Super Administrator standing privileges across the domain" },
  { email: "gws-user-admins@company.com", name: "GWS User Admins Group", description: "Provides capabilities to create, suspend, and reset passwords for domain users" },
  { email: "gws-billing-leads@company.com", name: "GWS Billing Leads Group", description: "Provides access to modify domain billing methods, plan upgrades and licenses" },
  { email: "gws-security-ops@company.com", name: "GWS Security Ops Group", description: "Provides access to Google Workspace API access controls, SSO, and security logs" }
];

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
}

// Cache exchanged DWD OAuth2 tokens for 55 minutes (out of 60m lifetime)
const TOKEN_CACHE = new Map<string, CachedAccessToken>();
const TOKEN_TTL_MS = 55 * 60 * 1000;
const MAX_DIRECTORY_PAGES = 50;

export function clearGoogleTokenCache(): void {
  TOKEN_CACHE.clear();
}

function getCachedToken(cacheKey: string): string | null {
  const entry = TOKEN_CACHE.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    TOKEN_CACHE.delete(cacheKey);
    return null;
  }
  return entry.accessToken;
}

function setCachedToken(cacheKey: string, accessToken: string): void {
  TOKEN_CACHE.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + TOKEN_TTL_MS
  });
}

async function getAdminClientForConfig(
  serviceAccountJson?: string,
  serviceAccountEmail?: string,
  adminEmail?: string,
  mode?: 'MOCK' | 'LIVE'
) {
  if (mode === 'MOCK' || !adminEmail) {
    return null;
  }

  // 1. Explicit JSON credentials (Service Account or External WIF config)
  if (serviceAccountJson && serviceAccountJson.trim() !== '') {
    try {
      const credentials = JSON.parse(serviceAccountJson);

      if (credentials.type === 'service_account') {
        if (process.env.REQUIRE_KEYLESS_DWD === 'true') {
          throw new Error(
            'Raw service_account private keys are disabled by REQUIRE_KEYLESS_DWD=true. Configure keyless Workload Identity instead.'
          );
        }

        const auth = new google.auth.JWT(
          credentials.client_email,
          undefined,
          credentials.private_key,
          ['https://www.googleapis.com/auth/admin.directory.group'],
          adminEmail
        );

        return google.admin({ version: 'directory_v1', auth });
      } else if (credentials.type === 'external_account') {
        let saEmail = '';
        if (credentials.service_account_impersonation_url) {
          const match = credentials.service_account_impersonation_url.match(/serviceAccounts\/(.+?):/);
          if (match && match[1]) {
            saEmail = match[1];
          }
        }

        if (!saEmail) {
          throw new Error(
            'Could not extract service account email from Workload Identity Federation configuration. Ensure service_account_impersonation_url is set.'
          );
        }

        const cacheKey = `ext_wif::${saEmail.toLowerCase()}::${adminEmail.toLowerCase()}`;
        let accessToken = getCachedToken(cacheKey);

        if (!accessToken) {
          const wifAuth = google.auth.fromJSON(credentials);
          const iat = Math.floor(Date.now() / 1000);
          const exp = iat + 3600;
          const payload = {
            iss: saEmail,
            sub: adminEmail,
            aud: 'https://oauth2.googleapis.com/token',
            iat,
            exp,
            scope: 'https://www.googleapis.com/auth/admin.directory.group'
          };

          const signUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${saEmail}:signJwt`;
          logStructured('INFO', 'GOOGLE_API', `Requesting IAM signature via WIF client for ${saEmail}`);

          const signRes = await wifAuth.request<{ signedJwt: string }>({
            url: signUrl,
            method: 'POST',
            data: { payload: JSON.stringify(payload) }
          });

          const tokenRes = await wifAuth.request<{ access_token: string }>({
            url: 'https://oauth2.googleapis.com/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: new URLSearchParams({
              grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
              assertion: signRes.data.signedJwt
            }).toString()
          });

          accessToken = tokenRes.data.access_token;
          setCachedToken(cacheKey, accessToken);
        }

        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: accessToken });
        return google.admin({ version: 'directory_v1', auth: oAuth2Client });
      } else {
        throw new Error(`Unsupported credentials type: ${credentials.type}`);
      }
    } catch (error) {
      logStructured('ERROR', 'GOOGLE_API', 'Error creating Google Admin Client (JSON config)', {
        error: (error as Error).message
      });
      throw new Error(`Failed to initialize Google API client: ${(error as Error).message}`);
    }
  }

  // 2. Ambient Keyless Workload Identity via IAMCredentials signJwt
  if (serviceAccountEmail && serviceAccountEmail.trim() !== '') {
    try {
      const normalizedSa = serviceAccountEmail.trim();
      const cacheKey = `keyless::${normalizedSa.toLowerCase()}::${adminEmail.toLowerCase()}`;
      let accessToken = getCachedToken(cacheKey);

      if (!accessToken) {
        const auth = new GoogleAuth({
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();

        const iat = Math.floor(Date.now() / 1000);
        const exp = iat + 3600;
        const payload = {
          iss: normalizedSa,
          sub: adminEmail,
          aud: 'https://oauth2.googleapis.com/token',
          iat,
          exp,
          scope: 'https://www.googleapis.com/auth/admin.directory.group'
        };

        const signUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${normalizedSa}:signJwt`;
        logStructured('INFO', 'GOOGLE_API', `Requesting IAM signature for keyless DWD on ${normalizedSa}`);

        const signRes = await client.request<{ signedJwt: string }>({
          url: signUrl,
          method: 'POST',
          data: { payload: JSON.stringify(payload) }
        });

        const tokenRes = await client.request<{ access_token: string }>({
          url: 'https://oauth2.googleapis.com/token',
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signRes.data.signedJwt
          }).toString()
        });

        accessToken = tokenRes.data.access_token;
        setCachedToken(cacheKey, accessToken);
      }

      const oAuth2Client = new google.auth.OAuth2();
      oAuth2Client.setCredentials({ access_token: accessToken });
      return google.admin({ version: 'directory_v1', auth: oAuth2Client });
    } catch (error) {
      logStructured('ERROR', 'GOOGLE_API', 'Error creating Google Admin Client (Keyless)', {
        error: (error as Error).message
      });
      throw new Error(`Failed to initialize Google API client (Keyless): ${(error as Error).message}`);
    }
  }

  return null;
}

async function getAdminClientForGroup(groupEmail: string) {
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
    const hasSpaceAuth =
      (space.serviceAccountJson && space.serviceAccountJson.trim() !== '') ||
      (space.serviceAccountEmail && space.serviceAccountEmail.trim() !== '');
    const saJson = hasSpaceAuth ? space.serviceAccountJson : config.serviceAccountJson;
    const saEmail = hasSpaceAuth ? space.serviceAccountEmail : config.serviceAccountEmail;
    const adminEmail = space.adminEmail || config.adminEmail;
    const isMock = config.mode === 'MOCK' || (!saJson && !saEmail) || !adminEmail;
    return {
      admin: await getAdminClientForConfig(saJson, saEmail, adminEmail, config.mode),
      isMock,
      spaceName: space.name
    };
  }

  const fallbackSaJson = config.serviceAccountJson || process.env.GWS_SERVICE_ACCOUNT_JSON;
  const globalIsMock =
    config.mode === 'MOCK' ||
    (!fallbackSaJson && !config.serviceAccountEmail) ||
    !config.adminEmail;
  return {
    admin: await getAdminClientForConfig(
      fallbackSaJson,
      config.serviceAccountEmail,
      config.adminEmail,
      config.mode
    ),
    isMock: globalIsMock,
    spaceName: 'Global'
  };
}

export async function listGroups(): Promise<WorkspaceGroup[]> {
  const config = await getConfig();
  const spaces = await getSpaces();

  if (config.mode === 'MOCK') {
    const groups = [...MOCK_GROUPS];
    for (const space of spaces) {
      groups.push(
        { email: `gws-super-admins@${space.domain}`, name: `GWS Super Admins Group (${space.name})`, description: `Provides Super Administrator privileges for space ${space.name}` },
        { email: `gws-user-admins@${space.domain}`, name: `GWS User Admins Group (${space.name})`, description: `Provides capabilities to manage users in space ${space.name}` },
        { email: `gws-billing-leads@${space.domain}`, name: `GWS Billing Leads Group (${space.name})`, description: `Provides billing management in space ${space.name}` },
        { email: `gws-security-ops@${space.domain}`, name: `GWS Security Ops Group (${space.name})`, description: `Provides security operation access in space ${space.name}` }
      );
    }
    return groups;
  }

  const allGroups: WorkspaceGroup[] = [];
  const visitedEmails = new Set<string>();

  const queryAndAdd = async (
    saJson?: string,
    saEmail?: string,
    adminEmail?: string,
    domain?: string
  ) => {
    if ((!saJson && !saEmail) || !adminEmail) return;
    try {
      const admin = await getAdminClientForConfig(saJson, saEmail, adminEmail, 'LIVE');
      if (!admin) return;

      let pageToken: string | undefined = undefined;
      let pageCount = 0;

      do {
        const response: { data: { groups?: Array<{ email?: string | null; name?: string | null; description?: string | null }>; nextPageToken?: string | null } } =
          await admin.groups.list({
            ...(domain ? { domain } : { customer: 'my_customer' }),
            maxResults: 200,
            pageToken
          });

        const groups = response.data.groups || [];
        for (const g of groups) {
          if (!g.email) continue;
          const email = String(g.email).toLowerCase();
          if (!visitedEmails.has(email)) {
            visitedEmails.add(email);
            allGroups.push({
              email: String(g.email),
              name: String(g.name || g.email),
              description: g.description || undefined
            });
          }
        }

        pageToken = response.data.nextPageToken || undefined;
        pageCount++;
      } while (pageToken && pageCount < MAX_DIRECTORY_PAGES);
    } catch (error) {
      logStructured('ERROR', 'GOOGLE_API', `Error listing groups for operator ${adminEmail}`, {
        error: (error as Error).message
      });
    }
  };

  await queryAndAdd(
    config.serviceAccountJson || process.env.GWS_SERVICE_ACCOUNT_JSON,
    config.serviceAccountEmail,
    config.adminEmail,
    config.domain
  );

  for (const space of spaces) {
    const hasSpaceAuth =
      (space.serviceAccountJson && space.serviceAccountJson.trim() !== '') ||
      (space.serviceAccountEmail && space.serviceAccountEmail.trim() !== '');
    const saJson = hasSpaceAuth ? space.serviceAccountJson : config.serviceAccountJson;
    const saEmail = hasSpaceAuth ? space.serviceAccountEmail : config.serviceAccountEmail;
    const adminEmail = space.adminEmail || config.adminEmail;
    await queryAndAdd(saJson, saEmail, adminEmail, space.domain);
  }

  return allGroups;
}

// Track mock-mode remediated orphans per group so UI remediation works deterministically in MOCK mode too
const MOCK_REMEDIATED_ORPHANS = new Set<string>();

export async function addGroupMember(groupEmail: string, userEmail: string): Promise<void> {
  const { admin, isMock, spaceName } = await getAdminClientForGroup(groupEmail);
  if (isMock || !admin) {
    logStructured('INFO', 'GOOGLE_MOCK', `Added ${userEmail} to ${groupEmail}`, { spaceName });
    return;
  }

  try {
    await admin.members.insert({
      groupKey: groupEmail,
      requestBody: {
        email: userEmail,
        role: 'MEMBER'
      }
    });
    logStructured('INFO', 'GOOGLE_API', `Added ${userEmail} to Workspace group ${groupEmail}`, { spaceName });
  } catch (error) {
    logStructured('ERROR', 'GOOGLE_API', `Failed adding ${userEmail} to ${groupEmail}`, {
      spaceName,
      error: (error as Error).message
    });
    throw new Error(`Google Workspace group membership addition failed: ${(error as Error).message}`);
  }
}

export async function removeGroupMember(groupEmail: string, userEmail: string): Promise<void> {
  const { admin, isMock, spaceName } = await getAdminClientForGroup(groupEmail);
  if (isMock || !admin) {
    MOCK_REMEDIATED_ORPHANS.add(`${groupEmail.toLowerCase()}::${userEmail.toLowerCase()}`);
    logStructured('INFO', 'GOOGLE_MOCK', `Removed ${userEmail} from ${groupEmail}`, { spaceName });
    return;
  }

  try {
    await admin.members.delete({
      groupKey: groupEmail,
      memberKey: userEmail
    });
    logStructured('INFO', 'GOOGLE_API', `Removed ${userEmail} from Workspace group ${groupEmail}`, { spaceName });
  } catch (error) {
    logStructured('ERROR', 'GOOGLE_API', `Failed removing ${userEmail} from ${groupEmail}`, {
      spaceName,
      error: (error as Error).message
    });
    throw new Error(`Google Workspace group membership deletion failed: ${(error as Error).message}`);
  }
}

export async function listGroupMembers(groupEmail: string): Promise<string[]> {
  const { admin, isMock, spaceName } = await getAdminClientForGroup(groupEmail);
  if (isMock || !admin) {
    logStructured('INFO', 'GOOGLE_MOCK', `Listing members for ${groupEmail}`, { spaceName });
    const mockMembers = ['superadmin@company.com'];
    if (!MOCK_REMEDIATED_ORPHANS.has(`${groupEmail.toLowerCase()}::orphaned-user@company.com`)) {
      mockMembers.push('orphaned-user@company.com');
    }
    return mockMembers;
  }

  try {
    const allMembers: string[] = [];
    let pageToken: string | undefined = undefined;
    let pageCount = 0;

    do {
      const response: { data: { members?: Array<{ email?: string | null }>; nextPageToken?: string | null } } =
        await admin.members.list({
          groupKey: groupEmail,
          maxResults: 200,
          pageToken
        });

      const members = response.data.members || [];
      for (const m of members) {
        if (m.email) {
          allMembers.push(String(m.email).toLowerCase());
        }
      }

      pageToken = response.data.nextPageToken || undefined;
      pageCount++;
    } while (pageToken && pageCount < MAX_DIRECTORY_PAGES);

    return allMembers;
  } catch (error) {
    logStructured('ERROR', 'GOOGLE_API', `Failed listing members for ${groupEmail}`, {
      spaceName,
      error: (error as Error).message
    });
    throw new Error(`Google Workspace group members list failed: ${(error as Error).message}`);
  }
}
