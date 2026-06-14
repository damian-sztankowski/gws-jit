import { getRequests, updateRequest, addLog } from './db.js';
import { removeGroupMember } from './google.js';
import { sendNotification } from './notifications.js';

let intervalId: NodeJS.Timeout | null = null;

export async function checkExpiredRequests() {
  try {
    const requests = await getRequests();
    const now = new Date();

    const activeRequests = requests.filter(r => r.status === 'ACTIVE');

    for (const req of activeRequests) {
      if (req.expiresAt && new Date(req.expiresAt) <= now) {
        console.log(`[SCHEDULER] JIT membership for ${req.requesterEmail} in group ${req.groupEmail} has expired. Revoking...`);
        
        try {
          // Remove member from group using their email and group email
          await removeGroupMember(req.groupEmail, req.requesterEmail);

          const updatedReq = {
            ...req,
            status: 'EXPIRED' as const,
            revokedAt: new Date().toISOString()
          };

          await updateRequest(updatedReq);
          await addLog(
            'SYSTEM',
            'REVOKE_JIT',
            `Automatically removed ${req.requesterEmail} from group ${req.groupName} (Duration expired)`
          );
          
          // Dispatch notification
          await sendNotification(req.groupEmail, {
            title: `JIT Access EXPIRED`,
            message: `JIT access for ${req.requesterEmail} to group ${req.groupName} has expired and has been automatically revoked.`,
            requestDetails: {
              id: req.id,
              requesterEmail: req.requesterEmail,
              groupEmail: req.groupEmail,
              durationMinutes: req.durationMinutes,
              justification: req.justification,
              status: 'EXPIRED'
            }
          });

          console.log(`[SCHEDULER] Request ${req.id} successfully expired and membership revoked.`);
        } catch (error) {
          console.error(`[SCHEDULER] Failed to auto-revoke request ${req.id}:`, error);
          await addLog(
            'SYSTEM',
            'REVOKE_ERROR',
            `Failed to auto-revoke group membership in ${req.groupName} for ${req.requesterEmail}: ${(error as Error).message}`
          );
          // We will leave the status as ACTIVE so that it retries on the next tick
        }
      }
    }
  } catch (error) {
    console.error("[SCHEDULER] Error in checkExpiredRequests loop:", error);
  }
}

export function startScheduler(intervalMs: number = 30000) {
  if (intervalId) return;
  
  console.log(`[SCHEDULER] Starting background JIT expiration scheduler (tick every ${intervalMs / 1000}s)`);
  
  // Run check immediately
  checkExpiredRequests();
  
  intervalId = setInterval(checkExpiredRequests, intervalMs);
}

export function stopScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[SCHEDULER] Stopped background JIT expiration scheduler");
  }
}
