import { getActiveRequests, claimExpiredRequest, updateRequest, addLog } from './db.js';
import { removeGroupMember } from './google.js';
import { sendNotification } from './notifications.js';
import { broadcastEvent, logStructured } from './events.js';

let intervalId: NodeJS.Timeout | null = null;
let isProcessing = false;

export async function checkExpiredRequests(): Promise<number> {
  if (isProcessing) {
    return 0;
  }

  isProcessing = true;
  let revokedCount = 0;
  try {
    const activeRequests = await getActiveRequests();
    const now = new Date();

    for (const req of activeRequests) {
      if (req.expiresAt && new Date(req.expiresAt) <= now) {
        const revokedAt = new Date().toISOString();
        const claimed = await claimExpiredRequest(req.id, revokedAt);
        if (!claimed) {
          continue;
        }

        logStructured('INFO', 'SCHEDULER', `Revoking expired JIT membership for ${req.requesterEmail}`, {
          requestId: req.id,
          groupEmail: req.groupEmail
        });

        try {
          await removeGroupMember(req.groupEmail, req.requesterEmail);

          revokedCount++;
          await addLog(
            'SYSTEM',
            'REVOKE_JIT',
            `Automatically removed ${req.requesterEmail} from group ${req.groupName} (Duration expired)`
          );

          await sendNotification(req.groupEmail, {
            title: `JIT Access EXPIRED`,
            message: `JIT access for ${req.requesterEmail} to group ${req.groupName} has expired and has been automatically revoked.`,
            requestDetails: {
              id: req.id,
              requesterEmail: req.requesterEmail,
              groupEmail: req.groupEmail,
              durationMinutes: req.durationMinutes,
              justification: req.justification,
              ticketId: req.ticketId,
              isBreakGlass: req.isBreakGlass,
              status: 'EXPIRED'
            }
          });

          broadcastEvent('REQUEST_EXPIRED', { requestId: req.id, groupEmail: req.groupEmail });
        } catch (error) {
          logStructured('ERROR', 'SCHEDULER', `Failed to auto-revoke request ${req.id}`, {
            error: (error as Error).message
          });
          await updateRequest({
            ...req,
            status: 'ACTIVE'
          });
          await addLog(
            'SYSTEM',
            'REVOKE_ERROR',
            `Failed to auto-revoke group membership in ${req.groupName} for ${req.requesterEmail}: ${(error as Error).message}`
          );
        }
      }
    }
  } catch (error) {
    logStructured('ERROR', 'SCHEDULER', 'Error in checkExpiredRequests loop', {
      error: (error as Error).message
    });
  } finally {
    isProcessing = false;
  }
  return revokedCount;
}

export function startScheduler(intervalMs: number = 30000) {
  if (intervalId) return;

  logStructured('INFO', 'SCHEDULER', `Starting JIT expiration scheduler (interval: ${intervalMs / 1000}s)`);
  checkExpiredRequests();
  intervalId = setInterval(checkExpiredRequests, intervalMs);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logStructured('INFO', 'SCHEDULER', 'Stopped JIT expiration scheduler');
  }
}
