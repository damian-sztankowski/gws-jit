import { google } from 'googleapis';
import { WorkspaceGroup } from './types.js';
import { getConfig, getSpaces } from './db.js';

const MOCK_GROUPS: WorkspaceGroup[] = [
  { email: "gws-super-admins@company.com", name: "GWS Super Admins Group", description: "Provides Super Administrator standing privileges across the domain" },
  { email: "gws-user-admins@company.com", name: "GWS User Admins Group", description: "Provides capabilities to create, suspend, and reset passwords for domain users" },
  { email: "gws-billing-leads@company.com", name: "GWS Billing Leads Group", description: "Provides access to modify domain billing methods, plan upgrades and licenses" },
  { email: "gws-security-ops@company.com", name: "GWS Security Ops Group", description: "Provides access to Google Workspace API access controls, SSO, and security logs" }
];

import { GoogleAuth } from 'google-auth-library';

async function getAdminClientForConfig(
  serviceAccountJson?: string,
  serviceAccountEmail?: string,
  adminEmail?: string,
  mode?: 'MOCK' | 'LIVE'
) {
  if (mode === 'MOCK' || !adminEmail) {
    return null;
  }

  // 1. If serviceAccountJson is specified, check the type of credentials
  if (serviceAccountJson && serviceAccountJson.trim() !== '') {
    try {
      const credentials = JSON.parse(serviceAccountJson);
      
      if (credentials.type === 'service_account') {
        const auth = new google.auth.JWT(
          credentials.client_email,
          undefined,
          credentials.private_key,
          [
            'https://www.googleapis.com/auth/admin.directory.group'
          ],
          adminEmail // Impersonate a Workspace Admin
        );

        return google.admin({ version: 'directory_v1', auth });
      } else if (credentials.type === 'external_account') {
        // Workload Identity Federation (WIF) credential configuration file
        const wifAuth = google.auth.fromJSON(credentials);
        
        let saEmail = '';
        if (credentials.service_account_impersonation_url) {
          const match = credentials.service_account_impersonation_url.match(/serviceAccounts\/(.+?):/);
          if (match && match[1]) {
            saEmail = match[1];
          }
        }
        
        if (!saEmail) {
          throw new Error("Could not extract service account email from Workload Identity Federation configuration. Ensure service_account_impersonation_url is set.");
        }

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
        console.log(`[Google API] Requesting IAM signature via WIF client for ${saEmail}...`);
        
        const signRes = await wifAuth.request<{ signedJwt: string }>({
          url: signUrl,
          method: 'POST',
          data: {
            payload: JSON.stringify(payload)
          }
        });

        const signedJwt = signRes.data.signedJwt;

        console.log(`[Google API] Exchanging signed JWT for access token...`);
        const tokenRes = await wifAuth.request<{ access_token: string }>({
          url: 'https://oauth2.googleapis.com/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          data: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: signedJwt
          }).toString()
        });

        const oAuth2Client = new google.auth.OAuth2();
        oAuth2Client.setCredentials({ access_token: tokenRes.data.access_token });
        return google.admin({ version: 'directory_v1', auth: oAuth2Client });
      } else {
        throw new Error(`Unsupported credentials type: ${credentials.type}`);
      }
    } catch (error) {
      console.error("Error creating Google Admin Client (File-based):", error);
      throw new Error(`Failed to initialize Google API client: ${(error as Error).message}`);
    }
  }

  // 2. If serviceAccountEmail is specified, use keyless delegation via IAMCredentials signJwt
  if (serviceAccountEmail && serviceAccountEmail.trim() !== '') {
    try {
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform']
      });
      const client = await auth.getClient();

      const iat = Math.floor(Date.now() / 1000);
      const exp = iat + 3600;
      const payload = {
        iss: serviceAccountEmail,
        sub: adminEmail,
        aud: 'https://oauth2.googleapis.com/token',
        iat,
        exp,
        scope: 'https://www.googleapis.com/auth/admin.directory.group'
      };

      const signUrl = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccountEmail}:signJwt`;
      console.log(`[Google API] Requesting IAM signature for keyless DWD on ${serviceAccountEmail}...`);
      const signRes = await client.request<{ signedJwt: string }>({
        url: signUrl,
        method: 'POST',
        data: {
          payload: JSON.stringify(payload)
        }
      });

      const signedJwt = signRes.data.signedJwt;

      console.log(`[Google API] Exchanging signed JWT for access token...`);
      const tokenRes = await client.request<{ access_token: string }>({
        url: 'https://oauth2.googleapis.com/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: signedJwt
        }).toString()
      });

      const oAuth2Client = new google.auth.OAuth2();
      oAuth2Client.setCredentials({ access_token: tokenRes.data.access_token });
      return google.admin({ version: 'directory_v1', auth: oAuth2Client });
    } catch (error) {
      console.error("Error creating Google Admin Client (Keyless):", error);
      throw new Error(`Failed to initialize Google API client (Keyless): ${(error as Error).message}`);
    }
  }

  return null;
}

async function getAdminClientForGroup(groupEmail: string) {
  const config = await getConfig();
  const spaces = await getSpaces();
  const domain = groupEmail.split('@')[1]?.toLowerCase();
  
  const space = spaces.find(s => s.domain.toLowerCase() === domain);
  if (space) {
    const hasSpaceAuth = (space.serviceAccountJson && space.serviceAccountJson.trim() !== '') || 
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
  
  const globalIsMock = config.mode === 'MOCK' || 
                       (!config.serviceAccountJson && !config.serviceAccountEmail) || 
                       !config.adminEmail;
  return {
    admin: await getAdminClientForConfig(config.serviceAccountJson, config.serviceAccountEmail, config.adminEmail, config.mode),
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

  const queryAndAdd = async (saJson?: string, saEmail?: string, adminEmail?: string, domain?: string) => {
    if ((!saJson && !saEmail) || !adminEmail) return;
    try {
      const admin = await getAdminClientForConfig(saJson, saEmail, adminEmail, 'LIVE');
      if (!admin) return;
      
      const response = await admin.groups.list(
        domain ? { domain } : { customer: 'my_customer' }
      );
      
      const groups = response.data.groups || [];
      for (const g of groups) {
        const email = String(g.email).toLowerCase();
        if (!visitedEmails.has(email)) {
          visitedEmails.add(email);
          allGroups.push({
            email: String(g.email),
            name: String(g.name),
            description: g.description || undefined
          });
        }
      }
    } catch (error) {
      console.error(`Error listing groups for admin ${adminEmail}:`, error);
    }
  };

  // 1. Query global
  await queryAndAdd(config.serviceAccountJson, config.serviceAccountEmail, config.adminEmail, config.domain);

  // 2. Query spaces
  for (const space of spaces) {
    const hasSpaceAuth = (space.serviceAccountJson && space.serviceAccountJson.trim() !== '') || 
                         (space.serviceAccountEmail && space.serviceAccountEmail.trim() !== '');
    const saJson = hasSpaceAuth ? space.serviceAccountJson : config.serviceAccountJson;
    const saEmail = hasSpaceAuth ? space.serviceAccountEmail : config.serviceAccountEmail;
    const adminEmail = space.adminEmail || config.adminEmail;
    await queryAndAdd(saJson, saEmail, adminEmail, space.domain);
  }

  return allGroups;
}

export async function addGroupMember(groupEmail: string, userEmail: string): Promise<void> {
  const { admin, isMock, spaceName } = await getAdminClientForGroup(groupEmail);
  if (isMock || !admin) {
    console.log(`[MOCK] [Space: ${spaceName}] Added user ${userEmail} to group ${groupEmail}`);
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
    console.log(`Successfully added ${userEmail} to Workspace group ${groupEmail} (Space: ${spaceName})`);
  } catch (error) {
    console.error(`Error adding ${userEmail} to group ${groupEmail} (Space: ${spaceName}):`, error);
    throw new Error(`Google Workspace group membership addition failed: ${(error as Error).message}`);
  }
}

export async function removeGroupMember(groupEmail: string, userEmail: string): Promise<void> {
  const { admin, isMock, spaceName } = await getAdminClientForGroup(groupEmail);
  if (isMock || !admin) {
    console.log(`[MOCK] [Space: ${spaceName}] Removed user ${userEmail} from group ${groupEmail}`);
    return;
  }

  try {
    await admin.members.delete({
      groupKey: groupEmail,
      memberKey: userEmail
    });
    console.log(`Successfully removed ${userEmail} from Workspace group ${groupEmail} (Space: ${spaceName})`);
  } catch (error) {
    console.error(`Error removing ${userEmail} from group ${groupEmail} (Space: ${spaceName}):`, error);
    throw new Error(`Google Workspace group membership deletion failed: ${(error as Error).message}`);
  }
}

export async function listGroupMembers(groupEmail: string): Promise<string[]> {
  const { admin, isMock, spaceName } = await getAdminClientForGroup(groupEmail);
  if (isMock || !admin) {
    console.log(`[MOCK] [Space: ${spaceName}] Listing members for group ${groupEmail}`);
    // In Mock mode, simulate superadmin (active JIT or standing user) and an orphaned member
    return ["superadmin@company.com", "orphaned-user@company.com"];
  }

  try {
    const response = await admin.members.list({
      groupKey: groupEmail
    });
    const members = response.data.members || [];
    return members.map(m => String(m.email).toLowerCase());
  } catch (error) {
    console.error(`Error listing members for group ${groupEmail} (Space: ${spaceName}):`, error);
    throw new Error(`Google Workspace group members list failed: ${(error as Error).message}`);
  }
}
