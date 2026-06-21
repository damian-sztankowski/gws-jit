import dns from 'dns/promises';
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
  };
}

function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) {
    return true;
  }
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('172.')) {
    const parts = ip.split('.');
    if (parts.length >= 2) {
      const secondPart = parseInt(parts[1], 10);
      if (secondPart >= 16 && secondPart <= 31) {
        return true;
      }
    }
  }
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.toLowerCase().startsWith('fe80:')) return true;
  if (ip.toLowerCase().startsWith('fc00:') || ip.toLowerCase().startsWith('fd00:')) return true;
  return false;
}

export async function validateWebhookUrl(urlStr: string): Promise<void> {
  const url = new URL(urlStr);
  if (url.protocol !== 'https:') {
    throw new Error("Webhook URL must use secure HTTPS protocol.");
  }
  
  const hostname = url.hostname;
  let ipAddress: string;
  try {
    const lookup = await dns.lookup(hostname);
    ipAddress = lookup.address;
  } catch (err) {
    throw new Error(`Failed to resolve hostname '${hostname}': ${(err as Error).message}`);
  }
  
  const isProd = process.env.NODE_ENV === 'production' || process.env.AUTH_MODE === 'IAP';
  if (isProd) {
    if (isPrivateIp(ipAddress)) {
      throw new Error(`SSRF Guard: Outbound request to private/internal IP address '${ipAddress}' is blocked.`);
    }
  }
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
      `* **Justification:** _"${payload.requestDetails.justification}"_\n` +
      `* **Status:** \`${payload.requestDetails.status}\``
      : '');

  try {
    console.log(`[NOTIFICATION] Dispatching webhook to ${targetName} (${webhookUrl})...`);
    
    // Validate Webhook URL against SSRF and protocol rules
    await validateWebhookUrl(webhookUrl);

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
          `• *Justification:* _"${payload.requestDetails.justification}"_\n` +
          `• *Status:* \`${payload.requestDetails.status}\``
          : '');
    } else {
      textPayload = markdownText;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textPayload })
    });
    if (!response.ok) {
      console.error(`[NOTIFICATION] Webhook returned status ${response.status}: ${await response.text()}`);
    } else {
      console.log(`[NOTIFICATION] Webhook dispatched successfully.`);
    }
  } catch (err) {
    console.error(`[NOTIFICATION] Failed to send webhook:`, err);
  }
}

export async function dispatchTestWebhook(webhookUrl: string): Promise<void> {
  if (!webhookUrl) return;

  // Validate Webhook URL against SSRF and protocol rules
  await validateWebhookUrl(webhookUrl);

  const title = "Webhook Connection Test";
  const message = "Your GWS JIT Access Portal webhook integration is configured successfully! 🚀";

  try {
    console.log(`[NOTIFICATION] Dispatching test webhook to ${webhookUrl}...`);
    const isSlack = webhookUrl.toLowerCase().includes('slack.com');
    
    let textPayload = '';
    if (isSlack) {
      textPayload = `*${title.toUpperCase()}*\n\n${message}`;
    } else {
      textPayload = `### ${title}\n\n${message}`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textPayload })
    });
    if (!response.ok) {
      throw new Error(`Webhook returned status ${response.status}: ${await response.text()}`);
    }
    console.log(`[NOTIFICATION] Test webhook dispatched successfully.`);
  } catch (err) {
    console.error(`[NOTIFICATION] Failed to dispatch test webhook:`, err);
    throw err;
  }
}
