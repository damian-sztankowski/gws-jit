import dns from 'dns/promises';
import https from 'https';
import http from 'http';
import { getConfig, getSpaces } from './db.js';

export interface NotificationPayload {
  title: string;
  message: string;
  requestDetails?: {
    id: string;
    requesterEmail: string;
    groupEmail: string;
    durationMinutes: number;
    justification: string;
    status: string;
    ticketId?: string;
    isBreakGlass?: boolean;
    reviewNote?: string;
  };
}

function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase();
  const v4MappedPrefix = '::ffff:';
  const normalizedIp = ip.startsWith(v4MappedPrefix) ? ip.slice(v4MappedPrefix.length) : ip;

  if (
    normalizedIp === '127.0.0.1' ||
    normalizedIp === '0.0.0.0' ||
    normalizedIp === '::1' ||
    normalizedIp === '::' ||
    normalizedIp.startsWith('127.') ||
    normalizedIp.startsWith('0.')
  ) {
    return true;
  }
  if (normalizedIp.startsWith('10.')) return true;
  if (normalizedIp.startsWith('172.')) {
    const parts = normalizedIp.split('.');
    if (parts.length >= 2) {
      const secondPart = parseInt(parts[1], 10);
      if (secondPart >= 16 && secondPart <= 31) {
        return true;
      }
    }
  }
  if (normalizedIp.startsWith('100.')) {
    const parts = normalizedIp.split('.');
    if (parts.length >= 2) {
      const secondPart = parseInt(parts[1], 10);
      if (secondPart >= 64 && secondPart <= 127) {
        return true; // RFC 6598 Shared CGNAT space
      }
    }
  }
  if (normalizedIp.startsWith('192.168.')) return true;
  if (normalizedIp.startsWith('169.254.')) return true;
  // Multicast / reserved IPv4 (224.0.0.0/4 and 240.0.0.0/4)
  const firstOctet = parseInt(normalizedIp.split('.')[0], 10);
  if (Number.isFinite(firstOctet) && firstOctet >= 224) return true;

  if (normalizedIp.startsWith('fe80:')) return true;
  if (normalizedIp.startsWith('fc00:') || normalizedIp.startsWith('fd00:')) return true;
  return false;
}

export async function validateWebhookUrl(urlStr: string): Promise<{ ipAddress: string; family: 4 | 6 }> {
  const url = new URL(urlStr);
  if (url.protocol !== 'https:') {
    throw new Error("Webhook URL must use secure HTTPS protocol.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'metadata.google.internal' || hostname === 'localhost' || hostname.endsWith('.internal')) {
    throw new Error(`SSRF Guard: Outbound request to internal host '${hostname}' is blocked.`);
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch (err) {
    throw new Error(`Failed to resolve hostname '${hostname}': ${(err as Error).message}`);
  }

  if (!records || records.length === 0) {
    throw new Error(`No DNS records resolved for '${hostname}'.`);
  }

  for (const record of records) {
    if (isPrivateIp(record.address)) {
      throw new Error(`SSRF Guard: Outbound request to private/internal IP address '${record.address}' is blocked.`);
    }
  }

  const primary = records.find(r => r.family === 4) || records[0];
  return {
    ipAddress: primary.address,
    family: primary.family === 6 ? 6 : 4
  };
}

async function postPinnedHttpsJson(webhookUrl: string, payloadObj: unknown): Promise<void> {
  const { ipAddress, family } = await validateWebhookUrl(webhookUrl);
  const parsedUrl = new URL(webhookUrl);
  const bodyData = Buffer.from(JSON.stringify(payloadObj), 'utf-8');

  const agent = new https.Agent({
    lookup: (_hostname, _options, callback) => {
      callback(null, ipAddress, family);
    }
  });

  await new Promise<void>((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: 'POST',
        agent,
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': bodyData.length
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode || 0;
          if (status >= 300 && status < 400) {
            return reject(new Error(`SSRF Guard: Webhook HTTP redirect (${status}) is not permitted.`));
          }
          if (status < 200 || status >= 300) {
            return reject(new Error(`Webhook returned status ${status}: ${responseText}`));
          }
          resolve();
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Webhook request timed out after 10s.'));
    });
    req.on('error', (err) => reject(err));
    req.write(bodyData);
    req.end();
  });
}

export async function sendNotification(groupEmail: string, payload: NotificationPayload): Promise<void> {
  const config = await getConfig();
  const spaces = await getSpaces();
  
  // Resolve space settings or fallback to global using policy first, then domain suffix
  const normalizedGroupEmail = groupEmail.toLowerCase().trim();
  let space = spaces.find(s => 
    (s.groupPolicies || []).some(p => p.groupEmail.toLowerCase().trim() === normalizedGroupEmail)
  );
  if (!space) {
    const domain = groupEmail.split('@')[1]?.toLowerCase();
    space = spaces.find(s => s.domain.toLowerCase() === domain);
  }
  
  const webhookUrl = space ? space.webhookUrl : config.webhookUrl;
  const targetName = space ? `Space: ${space.name}` : 'Global Config';

  if (!webhookUrl) {
    // Skip if webhook is not configured
    return;
  }

  // Construct Markdown messages for Chat services
  const markdownText = `### ${payload.title}\n\n` +
    `**Message:** ${payload.message}\n` +
    (payload.requestDetails ? 
      `* **Request ID:** \`${payload.requestDetails.id}\`\n` +
      `* **Requester:** \`${payload.requestDetails.requesterEmail}\`\n` +
      `* **Group:** \`${payload.requestDetails.groupEmail}\`\n` +
      `* **Duration:** \`${payload.requestDetails.durationMinutes} minutes\`\n` +
      (payload.requestDetails.ticketId ? `* **Incident / Ticket ID:** \`${payload.requestDetails.ticketId}\`\n` : '') +
      (payload.requestDetails.isBreakGlass ? `* **Mode:** 🚨 \`EMERGENCY BREAK-GLASS\`\n` : '') +
      `* **Justification:** _"${payload.requestDetails.justification}"_\n` +
      (payload.requestDetails.reviewNote ? `* **Reviewer Note:** _"${payload.requestDetails.reviewNote}"_\n` : '') +
      `* **Status:** \`${payload.requestDetails.status}\``
      : '');

  try {
    console.log(`[NOTIFICATION] Dispatching webhook to ${targetName}...`);
    const isSlack = webhookUrl.toLowerCase().includes('slack.com');
    
    let textPayload = '';
    if (isSlack) {
      textPayload = `*${payload.title.toUpperCase()}*\n\n` +
        `*Message:* ${payload.message}\n` +
        (payload.requestDetails ? 
          `• *Request ID:* \`${payload.requestDetails.id}\`\n` +
          `• *Requester:* \`${payload.requestDetails.requesterEmail}\`\n` +
          `• *Group:* \`${payload.requestDetails.groupEmail}\`\n` +
          `• *Duration:* \`${payload.requestDetails.durationMinutes} minutes\`\n` +
          (payload.requestDetails.ticketId ? `• *Incident / Ticket ID:* \`${payload.requestDetails.ticketId}\`\n` : '') +
          (payload.requestDetails.isBreakGlass ? `• *Mode:* 🚨 \`EMERGENCY BREAK-GLASS\`\n` : '') +
          `• *Justification:* _"${payload.requestDetails.justification}"_\n` +
          (payload.requestDetails.reviewNote ? `• *Reviewer Note:* _"${payload.requestDetails.reviewNote}"_\n` : '') +
          `• *Status:* \`${payload.requestDetails.status}\``
          : '');
    } else {
      textPayload = markdownText;
    }

    await postPinnedHttpsJson(webhookUrl, { text: textPayload });
    console.log(`[NOTIFICATION] Webhook dispatched successfully.`);
  } catch (err) {
    console.error(`[NOTIFICATION] Failed to send webhook:`, err);
  }
}

export async function dispatchTestWebhook(webhookUrl: string): Promise<void> {
  if (!webhookUrl) return;

  const title = "Webhook Connection Test";
  const message = "Your GWS JIT Access Portal webhook integration is configured successfully! 🚀";

  try {
    console.log(`[NOTIFICATION] Dispatching test webhook...`);
    const isSlack = webhookUrl.toLowerCase().includes('slack.com');
    
    let textPayload = '';
    if (isSlack) {
      textPayload = `*${title.toUpperCase()}*\n\n${message}`;
    } else {
      textPayload = `### ${title}\n\n${message}`;
    }

    await postPinnedHttpsJson(webhookUrl, { text: textPayload });
    console.log(`[NOTIFICATION] Test webhook dispatched successfully.`);
  } catch (err) {
    console.error(`[NOTIFICATION] Failed to dispatch test webhook:`, err);
    throw err;
  }
}
