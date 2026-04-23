import { Queue } from "bullmq";
import type { RedisOptions } from "ioredis";
import { config } from "../config.js";

export const TRANSCODE_QUEUE = "transcode";

export interface TranscodeJobData {
  sha256: string;
  mimeType: string;
  /** Absolute path to the raw audio blob on disk. */
  storagePath: string;
}

/**
 * BullMQ requires its own Redis connection settings — don't share the
 * `getRedis()` client (BullMQ needs `maxRetriesPerRequest: null`).
 */
export function getRedisConnectionOptions(): RedisOptions {
  const u = new URL(config.redisUrl);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    password: u.password || undefined,
    username: u.username || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

let queue: Queue<TranscodeJobData> | null = null;

export function getTranscodeQueue(): Queue<TranscodeJobData> {
  if (!queue) {
    queue = new Queue<TranscodeJobData>(TRANSCODE_QUEUE, {
      connection: getRedisConnectionOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return queue;
}

export async function closeTranscodeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
