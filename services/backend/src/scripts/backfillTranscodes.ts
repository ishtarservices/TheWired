/**
 * One-shot CLI: enqueue transcode jobs for all pending uploads.
 *
 * Run (after `pnpm --filter @thewired/backend build`):
 *   node --env-file=.env dist/scripts/backfillTranscodes.js
 *
 * Throttled at ~2 enqueues/sec to avoid swamping the worker. Re-runnable:
 * `jobId: sha256` dedup in BullMQ means a second run is a no-op for jobs
 * already enqueued or in progress.
 */
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { getTranscodeQueue, closeTranscodeQueue } from "../lib/queue.js";

async function main() {
  const rows = await db
    .select({
      sha256: musicUploads.sha256,
      storagePath: musicUploads.storagePath,
      mimeType: musicUploads.mimeType,
    })
    .from(musicUploads)
    .where(
      and(
        eq(musicUploads.transcodeStatus, "pending"),
        eq(musicUploads.status, "active"),
      ),
    );

  console.log(`[backfill] found ${rows.length} pending uploads`);

  const queue = getTranscodeQueue();
  let enqueued = 0;
  for (const row of rows) {
    await queue.add(
      "transcode",
      { sha256: row.sha256, mimeType: row.mimeType, storagePath: row.storagePath },
      { jobId: row.sha256 },
    );
    enqueued++;
    if (enqueued % 50 === 0) {
      console.log(`[backfill] enqueued ${enqueued}/${rows.length}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[backfill] done — enqueued ${enqueued} jobs`);
  await closeTranscodeQueue();
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill] failed:", err);
  process.exit(1);
});
