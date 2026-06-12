import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  state: { ai: { prefs: {} as Record<string, unknown> } } as Record<string, unknown>,
  fetchImpl: (async () => ({})) as (url: string, init?: unknown) => Promise<unknown>,
  secrets: {} as Record<string, string>,
  /** Optional per-test override to defer specific keychain reads (race probes). */
  getSecretImpl: undefined as undefined | ((k: string) => Promise<string | null>),
}));

vi.mock("@/store", () => ({ store: { getState: () => h.state, dispatch: vi.fn() } }));
vi.mock("../engine/httpFetch", () => ({
  engineFetch: (url: string, init?: unknown) => h.fetchImpl(url, init),
}));
vi.mock("@/lib/nostr/secretStore", () => ({
  webSearchKeySecret: (pk: string) => `ws_${pk}`,
  getSecret: (k: string) =>
    h.getSecretImpl ? h.getSecretImpl(k) : Promise.resolve(h.secrets[k] ?? null),
  setSecret: async (k: string, v: string) => {
    h.secrets[k] = v;
  },
  deleteSecret: async (k: string) => {
    delete h.secrets[k];
  },
}));

import {
  WEB_SEARCH_PROVIDERS,
  getWebSearchProvider,
  webSearchTool,
  isWebSearchConfigured,
  loadWebSearchKey,
  getWebSearchKey,
  resetWebSearch,
  resetWebSearchBudget,
} from "../tools/webSearch";

const CTX = { conversationId: "c1", messageId: "m1", toolCallId: "t1" };

beforeEach(() => {
  h.state = { ai: { prefs: { webSearchEnabled: true, webSearchProvider: "tavily" } } };
  h.secrets = {};
  h.getSecretImpl = undefined;
  resetWebSearch();
  resetWebSearchBudget();
});

describe("web-search provider requests", () => {
  it("Tavily POSTs the key + query in the body", () => {
    const { url, init } = getWebSearchProvider("tavily").buildRequest("nostr", "tvly-k");
    expect(url).toBe("https://api.tavily.com/search");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ api_key: "tvly-k", query: "nostr" });
  });

  it("Brave puts the key in a header + encodes the query", () => {
    const { url, init } = getWebSearchProvider("brave").buildRequest("a b", "k");
    expect(url).toContain("q=a%20b");
    expect((init.headers as Record<string, string>)["X-Subscription-Token"]).toBe("k");
  });

  it("Exa puts the key in x-api-key", () => {
    const { init } = getWebSearchProvider("exa").buildRequest("q", "k");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("k");
  });

  it("unknown id falls back to the first provider", () => {
    expect(getWebSearchProvider("nope").id).toBe(WEB_SEARCH_PROVIDERS[0].id);
  });

  it("parseResults maps + caps results", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `u${i}`, content: "x" }));
    const parsed = getWebSearchProvider("tavily").parseResults({ results: many });
    expect(parsed.length).toBeLessThanOrEqual(5);
    expect(parsed[0]).toMatchObject({ title: "t0", url: "u0" });
  });
});

describe("webSearchTool.run", () => {
  it("rejects an empty query", async () => {
    const r = await webSearchTool.run({ query: " " }, CTX);
    expect(r.output).toMatch(/empty search query/i);
  });

  it("errors when not configured (no key loaded)", async () => {
    const r = await webSearchTool.run({ query: "hello" }, CTX);
    expect(r.output).toMatch(/isn't configured/i);
  });

  it("returns framed, untrusted results on success", async () => {
    h.secrets["ws_pk"] = "tvly-k";
    await loadWebSearchKey("pk");
    h.fetchImpl = async () => ({
      ok: true,
      json: async () => ({ results: [{ title: "Nostr", url: "https://nostr.com", content: "a protocol" }] }),
    });
    const r = await webSearchTool.run({ query: "what is nostr" }, CTX);
    expect(r.output).toContain("UNTRUSTED WEB SEARCH RESULTS");
    expect(r.output).toContain("https://nostr.com");
    expect(r.output).toContain("a protocol");
  });

  it("surfaces a non-ok response as an error (no throw)", async () => {
    h.secrets["ws_pk"] = "k";
    await loadWebSearchKey("pk");
    h.fetchImpl = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
    const r = await webSearchTool.run({ query: "hello" }, CTX);
    expect(r.output).toContain("429");
    expect(r.isError).toBe(true);
  });

  it("enforces a per-turn search budget", async () => {
    h.secrets["ws_pk"] = "k";
    await loadWebSearchKey("pk");
    h.fetchImpl = async () => ({ ok: true, json: async () => ({ results: [] }) });
    // 5 allowed; the 6th is blocked until the budget resets next turn.
    for (let i = 0; i < 5; i++) {
      const r = await webSearchTool.run({ query: `q${i}` }, CTX);
      expect(r.output).not.toMatch(/limit/i);
    }
    const sixth = await webSearchTool.run({ query: "q6" }, CTX);
    expect(sixth.output).toMatch(/limit/i);
    resetWebSearchBudget();
    const after = await webSearchTool.run({ query: "again" }, CTX);
    expect(after.output).not.toMatch(/limit/i);
  });

  it("keeps the budget separate per conversation", async () => {
    h.secrets["ws_pk"] = "k";
    await loadWebSearchKey("pk");
    h.fetchImpl = async () => ({ ok: true, json: async () => ({ results: [] }) });
    // Exhaust conversation c1's budget.
    for (let i = 0; i < 5; i++) await webSearchTool.run({ query: `q${i}` }, CTX);
    expect((await webSearchTool.run({ query: "xx" }, CTX)).output).toMatch(/limit/i);
    // A different conversation has its own untouched budget.
    const other = { conversationId: "c2", messageId: "m2", toolCallId: "t2" };
    expect((await webSearchTool.run({ query: "yy" }, other)).output).not.toMatch(/limit/i);
  });
});

describe("isWebSearchConfigured", () => {
  it("requires both the toggle and a loaded key", async () => {
    expect(isWebSearchConfigured()).toBe(false); // no key
    h.secrets["ws_pk"] = "k";
    await loadWebSearchKey("pk");
    expect(isWebSearchConfigured()).toBe(true);
    h.state = { ai: { prefs: { webSearchEnabled: false } } };
    expect(isWebSearchConfigured()).toBe(false); // toggle off
  });
});

describe("abort + lifecycle (audit #94/#49 probes)", () => {
  it("PROBE #94: threads the turn's AbortSignal into the search fetch", async () => {
    h.secrets["ws_pk"] = "k";
    await loadWebSearchKey("pk");
    let seenSignal: AbortSignal | undefined;
    h.fetchImpl = async (_url, init) => {
      seenSignal = (init as RequestInit | undefined)?.signal ?? undefined;
      return { ok: true, json: async () => ({ results: [] }) };
    };
    const controller = new AbortController();
    await webSearchTool.run({ query: "abortable" }, { ...CTX, signal: controller.signal });
    // Pre-fix: ToolContext had no signal field and engineFetch was called
    // without one — Stop could not cancel a paid in-flight search.
    expect(seenSignal).toBe(controller.signal);
  });

  it("PROBE #49: a key load resolving after an account switch is discarded", async () => {
    // Account A's keychain read is slow; the user switches to B (no key) while
    // it's in flight. Pre-fix, A's late resolution stomped the module key cache
    // and A's paid search key was used for B's session.
    let resolveA!: (v: string | null) => void;
    h.getSecretImpl = (k) =>
      k === "ws_A"
        ? new Promise<string | null>((r) => {
            resolveA = r;
          })
        : Promise.resolve(null);
    const loadA = loadWebSearchKey("A");
    const loadB = loadWebSearchKey("B");
    await loadB;
    resolveA("sk-A-search-key");
    await loadA;
    expect(getWebSearchKey()).toBeNull();
  });
});
