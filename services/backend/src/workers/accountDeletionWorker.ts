import { startLockedInterval } from "../lib/workerLock.js";
import { accountDeletionService } from "../services/accountDeletionService.js";

/** How soon a deletion left pending (a failed step, a crash) is retried. */
const INTERVAL_MS = 5 * 60 * 1000;

/**
 * Finishes account deletions left `pending` — at boot and every five minutes —
 * so the purge completes on its own. soot treats a 202 from DELETE /account as
 * accepted and wipes the device right after, so nobody will call again.
 */
export function startAccountDeletionWorker(): { stop: () => void } {
  const job = startLockedInterval({
    name: "accountDeletionWorker",
    intervalMs: INTERVAL_MS,
    task: async () => {
      const n = await accountDeletionService.resumePending();
      if (n > 0) console.warn(`[account-deletion] retried ${n} pending deletion(s)`);
    },
  });
  return { stop: () => job.stop() };
}
