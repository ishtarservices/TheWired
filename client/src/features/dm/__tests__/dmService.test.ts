import { describe, it, expect, vi, beforeEach } from "vitest";

// The service builds rumors + wraps through the giftWrap shim and publishes
// through relayManager; both are stubbed so we can assert the WIRE SHAPES
// (docs/DM_WIRE_CONTRACT.md §2–§5) without crypto or sockets.
const buildRumorSpy = vi.fn();
const wrapSpy = vi.fn();
const selfWrapSpy = vi.fn();
vi.mock("@/lib/nostr/giftWrap", () => ({
  buildRumor: async (...a: unknown[]) => {
    buildRumorSpy(...a);
    const [pubkey, recipient, content, extraTags, opts] = a as [string, string, string, string[][] | undefined, { kind?: number } | undefined];
    return { id: "r".repeat(64), pubkey, created_at: 1_700_000_000, kind: opts?.kind ?? 14, tags: [["p", recipient], ...(extraTags ?? [])], content };
  },
  createGiftWrappedDM: async (...a: unknown[]) => {
    wrapSpy(...a);
    return { wrap: { id: "w1".padEnd(64, "0"), kind: 1059, pubkey: "e".repeat(64), created_at: 1, tags: [], content: "", sig: "" }, rumorId: "r".repeat(64) };
  },
  createSelfWrap: async (...a: unknown[]) => {
    selfWrapSpy(...a);
    return { wrap: { id: "w2".padEnd(64, "0"), kind: 1059, pubkey: "e".repeat(64), created_at: 1, tags: [], content: "", sig: "" }, rumorId: "r".repeat(64) };
  },
  giftWrapContext: () => ({ myPubkey: "a".repeat(64), signer: {} }),
}));
const publishSpy = vi.fn((_event: unknown, _relays?: unknown) => 1);
vi.mock("@/lib/nostr/relayManager", () => {
  const base: Record<string, unknown> = {
    publish: (event: unknown, relays?: unknown) => publishSpy(event, relays),
    getWriteRelays: () => [{ url: "wss://w" }],
  };
  // Anything else the store/login modules touch at import time is a no-op.
  const relayManager = new Proxy(base, { get: (t, k: string) => (k in t ? t[k] : () => undefined) });
  return { relayManager };
});
vi.mock("@/lib/nostr/dmRelayList", () => ({
  getDMRelaysForPublish: async () => ["wss://peer"],
  getOwnDMRelays: () => ["wss://own"],
  fallbackDMRelays: () => ["wss://w", "ws://localhost:7777"],
}));
vi.mock("@/lib/nostr/publish", () => ({ signAndPublish: vi.fn(async () => {}) }));

import { store, resetAll } from "@/store";
import { login, setFollowList } from "@/store/slices/identitySlice";
import { addFriendRequest } from "@/store/slices/friendRequestSlice";
import { setConversationExpireAfter } from "@/store/slices/dmSlice";
import { sendDM, sendDMFile, reactToDM, removeDMReaction, sendTyping, sendReceipt, editDM } from "../dmService";
import { setDMPrefs, __resetDMPrefsForTest } from "../dmPrefs";

const ME = "a".repeat(64);
const PEER = "b".repeat(64);
const TARGET = "c".repeat(64);

const lastCall = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls[spy.mock.calls.length - 1];
const tagsOf = (spy: ReturnType<typeof vi.fn>) => (lastCall(spy)[3] as string[][] | undefined) ?? [];
const optsOf = (spy: ReturnType<typeof vi.fn>) => lastCall(spy)[4] as { kind?: number } | undefined;
const wrapOptsOf = (spy: ReturnType<typeof vi.fn>) => lastCall(spy)[4] as { expiration?: number } | undefined;

beforeEach(() => {
  store.dispatch(resetAll());
  __resetDMPrefsForTest();
  buildRumorSpy.mockClear();
  wrapSpy.mockClear();
  selfWrapSpy.mockClear();
  publishSpy.mockClear();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

describe("dmService — wire v1 write shapes", () => {
  it("sendDM writes an e reply anchor (rumor id) and no q", async () => {
    await sendDM(PEER, "hello", { wrapId: "legacy-wrap", rumorId: TARGET });
    const tags = tagsOf(buildRumorSpy);
    expect(tags).toContainEqual(["e", TARGET, ""]);
    expect(tags.some((t) => t[0] === "q")).toBe(false);
    expect(optsOf(buildRumorSpy)?.kind).toBe(14);
    expect(publishSpy).toHaveBeenCalledTimes(2); // recipient + self
    const msg = store.getState().dm.messages[PEER][0];
    expect(msg.replyToWrapId).toBe(TARGET);
    expect(msg.syncWarning).toBeUndefined();
  });

  it("sendDM flags the message when the self-wrap reached no relay", async () => {
    publishSpy.mockImplementationOnce(() => 1).mockImplementationOnce(() => 0);
    await sendDM(PEER, "hello");
    expect(store.getState().dm.messages[PEER][0].syncWarning).toBe(true);
  });

  it("reactToDM is a kind-7 rumor with e + k; removal stays a typed rumor", async () => {
    await reactToDM(PEER, TARGET, "🔥");
    expect(optsOf(buildRumorSpy)?.kind).toBe(7);
    expect(tagsOf(buildRumorSpy)).toEqual([["e", TARGET], ["k", "14"]]);
    await removeDMReaction(PEER, TARGET, "🔥");
    expect(optsOf(buildRumorSpy)?.kind).toBe(14);
    expect(tagsOf(buildRumorSpy)).toEqual([["type", "dm_reaction_remove"], ["e", TARGET]]);
  });

  it("sendDMFile is a kind-15 rumor whose content is the URL and whose tags carry the key", async () => {
    await sendDMFile(PEER, {
      url: "https://blossom/x.bin",
      fileType: "image/png",
      key: "1".repeat(64),
      nonce: "2".repeat(24),
      x: "3".repeat(64),
      ox: "4".repeat(64),
      size: 10,
    });
    expect(optsOf(buildRumorSpy)?.kind).toBe(15);
    expect(lastCall(buildRumorSpy)[2]).toBe("https://blossom/x.bin");
    const tags = tagsOf(buildRumorSpy);
    expect(tags).toContainEqual(["encryption-algorithm", "aes-gcm"]);
    expect(tags).toContainEqual(["decryption-key", "1".repeat(64)]);
    expect(tags).toContainEqual(["x", "3".repeat(64)]);
    expect(store.getState().dm.messages[PEER][0].attachment?.fileType).toBe("image/png");
  });

  it("a disappearing-messages timer puts expiration on the wraps", async () => {
    store.dispatch(setConversationExpireAfter({ conversationId: PEER, seconds: 3600, now: 1 }));
    await sendDM(PEER, "vanish");
    const now = Math.floor(Date.now() / 1000);
    const exp = wrapOptsOf(wrapSpy)?.expiration ?? 0;
    expect(Math.abs(exp - (now + 3600))).toBeLessThanOrEqual(5);
    expect(wrapOptsOf(selfWrapSpy)?.expiration).toBe(exp);
    expect(store.getState().dm.messages[PEER][0].expiresAt).toBe(1_700_000_000 + 3600);
  });

  it("edits stay typed and honour the 24h window", async () => {
    await editDM(PEER, TARGET, "fixed", Math.floor(Date.now() / 1000) - 3600);
    expect(tagsOf(buildRumorSpy)).toEqual([["type", "dm_edit"], ["e", TARGET]]);
    await expect(editDM(PEER, TARGET, "late", Math.floor(Date.now() / 1000) - 25 * 3600)).rejects.toThrow(/window/);
  });

  it("typing / receipts go only to friends, without a self-wrap, with an expiring wrap", async () => {
    // Not a friend → nothing sent.
    await sendTyping(PEER);
    expect(publishSpy).not.toHaveBeenCalled();

    store.dispatch(setFollowList({ follows: [PEER], createdAt: 1 }));
    store.dispatch(addFriendRequest({ id: "fr", pubkey: PEER, message: "", createdAt: 1, status: "accepted", direction: "incoming" }));
    await sendTyping(PEER);
    expect(optsOf(buildRumorSpy)?.kind).toBe(20014);
    expect(publishSpy).toHaveBeenCalledTimes(1); // recipient only
    expect(selfWrapSpy).not.toHaveBeenCalled();
    expect(wrapOptsOf(wrapSpy)?.expiration).toBeGreaterThan(Math.floor(Date.now() / 1000));

    await sendReceipt(PEER, "read", [TARGET]);
    expect(optsOf(buildRumorSpy)?.kind).toBe(20015);
    expect(tagsOf(buildRumorSpy)).toEqual([["status", "read"], ["e", TARGET]]);

    // Opt-out honoured.
    setDMPrefs({ receipts: false });
    publishSpy.mockClear();
    await sendReceipt(PEER, "read", [TARGET]);
    expect(publishSpy).not.toHaveBeenCalled();
  });
});
