import { Worker, type Job } from "bullmq";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db/connection.js";
import { musicUploads } from "../db/schema/music.js";
import { transcodeAudio } from "../lib/transcode.js";
import { config } from "../config.js";
import {
  TRANSCODE_QUEUE,
  getRedisConnectionOptions,
  type TranscodeJobData,
} from "../lib/queue.js";

export function startTranscodeWorker(): { stop: () => Promise<void> } {
  const worker = new Worker<TranscodeJobData>(
    TRANSCODE_QUEUE,
    async (job: Job<TranscodeJobData>) => {
      const { sha256, storagePath } = job.data;

      await db
        .update(musicUploads)
        .set({ transcodeStatus: "processing", transcodeError: null })
        .where(eq(musicUploads.sha256, sha256));

      try {
        const result = await transcodeAudio({
          inputPath: storagePath,
          sha256,
          blobDir: resolve(process.cwd(), config.blobDir),
        });
        await db
          .update(musicUploads)
          .set({
            transcodeStatus: "ready",
            hlsMasterPath: result.hlsRelPath,
            loudnessI: result.loudnessI,
            loudnessTp: result.loudnessTp,
            transcodedAt: new Date(),
            transcodeError: null,
          })
          .where(eq(musicUploads.sha256, sha256));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db
          .update(musicUploads)
          .set({
            transcodeStatus: "failed",
            transcodeError: msg.slice(0, 1000),
          })
          .where(eq(musicUploads.sha256, sha256));
        throw err;
      }
    },
    {
      connection: getRedisConnectionOptions(),
      concurrency: config.transcodeConcurrency,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[transcode] job ${job?.id} failed:`, err.message);
  });
  worker.on("completed", (job) => {
    console.log(`[transcode] job ${job.id} completed in ${job.processedOn ? Date.now() - job.processedOn : "?"}ms`);
  });

  return {
    async stop() {
      await worker.close();
    },
  };
}
