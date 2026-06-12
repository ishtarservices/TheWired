import { describe, it, expect, beforeEach, vi } from "vitest";

// Deferred keychain + provider seams: each getSecret/testConnection returns a
// promise the TEST resolves, so we can interleave account switches with the
// async gaps exactly where the audit races live.
const h = vi.hoisted(() => ({
  pendingGets: [] as { key: string; resolve: (v: string | null) => void }[],
  testConnects: [] as { id: string; resolve: (r: { ok: boolean; error?: string }) => void }[],
}));

vi.mock("@/lib/nostr/secretStore", () => ({
  getSecret: (key: string) =>
    new Promise<string | null>((resolve) => h.pendingGets.push({ key, resolve })),
  setSecret: vi.fn(async () => {}),
  deleteSecret: vi.fn(async () => {}),
  llmProvidersKey: (pk: string) => `llm_providers_${pk}`,
  llmApiKeySecret: (pk: string, id: string) => `llm_apikey_${pk}_${id}`,
  webSearchKeySecret: (pk: string) => `ai_websearch_key_${pk}`,
}));

function stubProvider(config: { id: string }) {
  return {
    id: config.id,
    kind: "openai-compat",
    chat: async function* () {},
    listModels: async () => [],
    testConnection: () =>
      new Promise<{ ok: boolean; error?: string }>((resolve) =>
        h.testConnects.push({ id: config.id, resolve }),
      ),
  };
}
vi.mock("../engine/providers/openaiCompat", () => ({
  makeOpenAICompatProvider: (config: { id: string }) => stubProvider(config),
}));
vi.mock("../engine/providers/anthropic", () => ({
  makeAnthropicProvider: (config: { id: string }) => stubProvider(config),
}));
vi.mock("../engine/detectLocal", () => ({ detectLocalEngines: async () => [] }));

import { store } from "@/store";
import { clearProviderStatus } from "@/store/slices/aiSlice";
import {
  loadProvidersForAccount,
  resetLLMManager,
  getProvider,
  getProviderConfig,
} from "../engine/llmManager";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Resolve a pending getSecret by key. No-op when the read was never issued
 *  (post-fix, a stale load bails before requesting the API key). */
function resolveGet(key: string, value: string | null): void {
  const idx = h.pendingGets.findIndex((g) => g.key === key);
  if (idx === -1) return;
  const [g] = h.pendingGets.splice(idx, 1);
  g.resolve(value);
}

function blob(providers: unknown[]): string {
  return JSON.stringify({ providers });
}

const provA = { id: "pa", kind: "openai-compat", label: "A cloud", baseUrl: "https://a", keyRequired: true };
const provB = { id: "pb", kind: "openai-compat", label: "B local", baseUrl: "http://b", keyRequired: false };

beforeEach(() => {
  resetLLMManager();
  store.dispatch(clearProviderStatus());
  h.pendingGets = [];
  h.testConnects = [];
});

describe("llmManager lifecycle (audit #49/#96 probes)", () => {
  it("PROBE #49: an in-flight load for account A cannot seed A's providers into B's session", async () => {
    // A's keychain blob read is slow; the user switches to B meanwhile.
    const loadA = loadProvidersForAccount("A");
    const loadB = loadProvidersForAccount("B");
    resolveGet("llm_providers_B", blob([provB]));
    await loadB;
    expect(store.getState().ai.providers["pb"]).toBeDefined();

    // A's read returns AFTER the switch — pre-fix its loop kept mutating the
    // (now B-owned) maps and its trailing sync dispatched A's configs into
    // Redux for B's session, with A's API key live in the shared key map.
    resolveGet("llm_providers_A", blob([provA]));
    await flush();
    resolveGet("llm_apikey_A_pa", "sk-A-secret");
    await loadA;
    await flush();

    expect(store.getState().ai.providers["pa"]).toBeUndefined();
    expect(store.getState().ai.providers["pb"]).toBeDefined();
    expect(getProvider("pa")).toBeUndefined();
    expect(getProviderConfig("pa")).toBeUndefined();
  });

  it("PROBE #49: a switch during the API-key read leaves no stale client/key behind", async () => {
    const loadA = loadProvidersForAccount("A");
    resolveGet("llm_providers_A", blob([provA]));
    await flush(); // A is now awaiting the per-provider API-key round-trip

    const loadB = loadProvidersForAccount("B");
    resolveGet("llm_providers_B", blob([]));
    await loadB;

    resolveGet("llm_apikey_A_pa", "sk-A-secret");
    await loadA;
    await flush();

    // Pre-fix: A's loop resumed after the clear and built pa's client with A's
    // key — usable for B's chats.
    expect(getProvider("pa")).toBeUndefined();
    expect(getProviderConfig("pa")).toBeUndefined();
    expect(store.getState().ai.providers["pa"]).toBeUndefined();
  });

  it("PROBE #96: reset tears everything down; a probe resolving after reset dispatches nothing", async () => {
    const load = loadProvidersForAccount("C");
    resolveGet("llm_providers_C", blob([provB]));
    await load;
    expect(store.getState().ai.providers["pb"]).toBeDefined();
    expect(store.getState().ai.providerStatus["pb"]?.status).toBe("connecting");

    resetLLMManager(); // logout OR feature-flag off
    expect(store.getState().ai.providers).toEqual({});
    expect(store.getState().ai.providerStatus).toEqual({});

    // The in-flight connection test settles late — it must not repopulate state.
    h.testConnects.find((t) => t.id === "pb")?.resolve({ ok: true });
    await flush();
    expect(store.getState().ai.providerStatus).toEqual({});
  });
});
