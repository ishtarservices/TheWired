/**
 * Global test setup for @thewired/backend
 *
 * Runs before all tests. Sets environment variables for the test DB,
 * Redis, and Meilisearch so that source modules connect to test
 * instances when imported.
 */

// Load .env.test from repo root (test user nsecs + optional DB overrides)
import { readFileSync } from "fs";
import { resolve } from "path";
try {
  // Vitest cwd is services/backend/, repo root is two levels up
  const envTest = readFileSync(resolve(process.cwd(), "../../.env.test"), "utf-8");
  for (const line of envTest.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  // .env.test missing -- tests will use deterministic fallback keys
}

// Override env BEFORE any source imports
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://thewired:thewired@localhost:5432/thewired_test";
process.env.REDIS_URL =
  process.env.TEST_REDIS_URL ?? "redis://localhost:6380/1";
process.env.MEILISEARCH_URL =
  process.env.TEST_MEILISEARCH_URL ?? "http://localhost:7700";
process.env.MEILISEARCH_KEY =
  process.env.TEST_MEILISEARCH_KEY ?? "thewired_dev_key";
process.env.LOG_LEVEL = "silent";
process.env.NODE_ENV = "test";

import { vi, beforeAll, afterAll, beforeEach } from "vitest";

// Mock Redis by default for unit tests.
// Integration tests that need real Redis should vi.unmock this.
vi.mock("../src/lib/redis.js", async () => {
  // @ts-expect-error -- ioredis-mock has no type declarations
  const mod = await import("ioredis-mock");
  const RedisMock = mod.default as new () => unknown;
  const instance = new RedisMock();
  return {
    getRedis: () => instance,
    redis: instance,
  };
});

// Mock Meilisearch by default for unit tests.
vi.mock("../src/lib/meilisearch.js", () => {
  const noop = () => Promise.resolve({});
  const mockIndex = {
    addDocuments: vi.fn().mockResolvedValue({ taskUid: 0 }),
    deleteDocument: vi.fn().mockResolvedValue({ taskUid: 0 }),
    deleteDocuments: vi.fn().mockResolvedValue({ taskUid: 0 }),
    search: vi.fn().mockResolvedValue({ hits: [], estimatedTotalHits: 0 }),
    updateSettings: vi.fn().mockResolvedValue({ taskUid: 0 }),
  };
  return {
    getMeilisearchClient: () => ({
      index: () => mockIndex,
      createIndex: noop,
      getIndex: () => mockIndex,
    }),
    ensureMeilisearchIndex: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock web-push by default
vi.mock("web-push", () => ({
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
}));

// The DB connection is a module-level singleton. It will read DATABASE_URL
// from the env we set above. No need to mock it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbClient: any = null;

beforeAll(async () => {
  // Dynamic import so env vars are set first
  const postgres = (await import("postgres")).default;
  dbClient = postgres(process.env.DATABASE_URL!);

  // Run the app's own migration runner (creates schemas + applies raw SQL files)
  const { runMigrations } = await import("../src/db/migrate.js");
  await runMigrations();
});

beforeEach(async () => {
  if (!dbClient) return;
  // Truncate all app.* tables between tests
  const tables = await dbClient`
    SELECT tablename FROM pg_tables WHERE schemaname = 'app'
  `;
  if (tables.length > 0) {
    const tableNames = tables.map((t: { tablename: string }) => `app."${t.tablename}"`).join(", ");
    await dbClient.unsafe(`TRUNCATE ${tableNames} CASCADE`);
  }
});

afterAll(async () => {
  if (dbClient) {
    await dbClient.end();
  }
});
