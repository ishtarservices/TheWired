import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// --- Stub import.meta.env defaults ---
// Vitest picks up VITE_* env vars automatically, but we provide safe defaults
// so tests don't need a .env file.
if (!import.meta.env.VITE_API_URL) {
  (import.meta.env as Record<string, string>).VITE_API_URL =
    "http://localhost:9080/api";
}
if (!import.meta.env.VITE_RELAY_URL) {
  (import.meta.env as Record<string, string>).VITE_RELAY_URL =
    "ws://localhost:7777";
}

// --- Mock Web Worker ---
// The verifyWorkerBridge creates a Worker via `new Worker(new URL(...))`.
// jsdom doesn't support Workers, so we provide a no-op stub.
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(_data: unknown) {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return false;
  }
}
vi.stubGlobal("Worker", MockWorker);

// --- Mock Tauri IPC ---
// TauriSigner calls invoke() from @tauri-apps/api/core.
// Default to rejecting (tests for TauriSigner will override per-test).
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockRejectedValue(new Error("Not in Tauri environment")),
}));

// Tauri plugin mocks
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn().mockRejectedValue(new Error("Not in Tauri")),
  writeTextFile: vi.fn().mockRejectedValue(new Error("Not in Tauri")),
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  BaseDirectory: { AppData: 0 },
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("Not in Tauri")),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// --- Mock verifyWorkerBridge ---
// Most tests don't need real schnorr verification.
// Individual test files can override with vi.mocked().
vi.mock("@/lib/nostr/verifyWorkerBridge", () => ({
  verifyBridge: {
    verify: vi.fn().mockResolvedValue(true),
    drainPending: vi.fn(),
    terminate: vi.fn(),
  },
}));
