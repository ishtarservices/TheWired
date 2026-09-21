import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";

// Wire contract v1 (docs/DM_WIRE_CONTRACT.md): the pipeline's gift-wrap path
// is exercised for real (validate → dedup → verify (globally mocked) → decrypt
// queue → handleGiftWrap → parseDMWire); only the NIP-44 unwrap is stubbed so a
// fake wrap yields the rumor we want.
const mockUnwrap = vi.fn();
vi.mock("@/lib/nostr/giftWrap", () => ({
  unwrapGiftWrap: (...a: unknown[]) => mockUnwrap(...a),
}));
const mockQueueDelivered = vi.fn();
vi.mock("@/lib/nostr/dmSignals", () => ({
  queueDeliveredReceipt: (...a: unknown[]) => mockQueueDelivered(...a),
}));

import { processIncomingEvent, resetEventPipelineCaches } from "../eventPipeline";
import { store, resetAll } from "@/store";
import { login, setMuteList } from "@/store/slices/identitySlice";
import { addDMMessage } from "@/store/slices/dmSlice";

const WS = "wss://relay.example";
const ME = "a".repeat(64);
const PARTNER = "b".repeat(64);
const THIRD = "c".repeat(64);
const RUMOR = "d".repeat(64);
const hex64 = (n: number) => n.toString(16).padStart(64, "0");

let wrapCounter = 100;
function wrap(): NostrEvent {
  const id = ++wrapCounter;
  return {
    id: hex64(id),
    pubkey: hex64(0xdead + id),
    created_at: Math.floor(Date.now() / 1000) - 3600,
    kind: 1059,
    tags: [["p", ME]],
    content: "ciphertext",
    sig: "0".repeat(128),
  };
}

interface Rumor {
  sender?: string;
  kind: number;
  content?: string;
  tags?: string[][];
  expiration?: number;
}
function rumor(r: Rumor, w: NostrEvent) {
  return {
    sender: r.sender ?? PARTNER,
    content: r.content ?? "",
    tags: r.tags ?? [["p", ME]],
    createdAt: Math.floor(Date.now() / 1000) - 60,
    wrapId: w.id,
    rumorId: hex64(0xf000 + wrapCounter),
    kind: r.kind,
    expiration: r.expiration,
  };
}

const settle = () => new Promise((res) => setTimeout(res, 0));

async function deliver(r: Rumor) {
  const w = wrap();
  mockUnwrap.mockResolvedValueOnce(rumor(r, w));
  await processIncomingEvent(w, WS);
  await settle();
  return w;
}

beforeEach(() => {
  store.dispatch(resetAll());
  resetEventPipelineCaches();
  mockUnwrap.mockReset();
  mockQueueDelivered.mockReset();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  store.dispatch(
    addDMMessage({
      partnerPubkey: PARTNER,
      myPubkey: ME,
      message: { id: "w", senderPubkey: ME, content: "mine", createdAt: 1000, wrapId: "target-wrap", rumorId: RUMOR },
    }),
  );
});

afterEach(() => {
  store.dispatch(resetAll());
});

const msgs = () => store.getState().dm.messages[PARTNER] ?? [];

describe("wire v1 routing through the pipeline", () => {
  it("a kind-7 rumor reacts to the message its last e tag names (spec form)", async () => {
    await deliver({ kind: 7, content: "🔥", tags: [["p", ME], ["e", "0".repeat(64)], ["e", RUMOR], ["k", "14"]] });
    expect(msgs()[0].reactions).toEqual({ "🔥": [PARTNER] });
    expect(msgs()).toHaveLength(1); // no chat bubble
  });

  it("an empty kind-7 content is the + reaction", async () => {
    await deliver({ kind: 7, content: "", tags: [["p", ME], ["e", RUMOR]] });
    expect(msgs()[0].reactions).toEqual({ "+": [PARTNER] });
  });

  it("an e-tag reply anchors on the rumor id; a legacy q reply still resolves", async () => {
    await deliver({ kind: 14, content: "re (spec)", tags: [["p", ME], ["e", RUMOR, ""]] });
    await deliver({ kind: 14, content: "re (legacy)", tags: [["p", ME], ["q", RUMOR]] });
    const spec = msgs().find((m) => m.content === "re (spec)")!;
    const legacy = msgs().find((m) => m.content === "re (legacy)")!;
    expect(spec.replyToWrapId).toBe(RUMOR);
    expect(legacy.replyToWrapId).toBe(RUMOR);
  });

  it("a kind-15 file message stores the attachment metadata and no text", async () => {
    const w = await deliver({
      kind: 15,
      content: "https://blossom.example/abc.bin",
      tags: [
        ["p", ME],
        ["file-type", "image/png"],
        ["encryption-algorithm", "aes-gcm"],
        ["decryption-key", "1".repeat(64)],
        ["decryption-nonce", "2".repeat(24)],
        ["x", "3".repeat(64)],
        ["ox", "4".repeat(64)],
        ["size", "1234"],
        ["dim", "640x480"],
      ],
    });
    const file = msgs().find((m) => m.wrapId === w.id)!;
    expect(file.kind).toBe(15);
    expect(file.content).toBe("");
    expect(file.attachment).toMatchObject({ url: "https://blossom.example/abc.bin", fileType: "image/png", size: 1234, dim: "640x480" });
    expect(file.wrapCreatedAt).toBe(w.created_at);
    // Delivered receipt queued for an incoming message.
    expect(mockQueueDelivered).toHaveBeenCalledWith(PARTNER, file.rumorId);
  });

  it("a kind-15 without a key is dropped, never rendered", async () => {
    await deliver({ kind: 15, content: "https://x/y", tags: [["p", ME], ["file-type", "image/png"], ["encryption-algorithm", "aes-gcm"]] });
    expect(msgs()).toHaveLength(1);
  });

  it("typing (20014) sets a short-lived hint; receipts (20015) mark our messages", async () => {
    await deliver({ kind: 20014 });
    const typing = store.getState().dm.typing[PARTNER];
    expect(typing?.[PARTNER]).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(msgs()).toHaveLength(1);

    await deliver({ kind: 20015, tags: [["p", ME], ["status", "read"], ["e", RUMOR]] });
    expect(msgs()[0].readBy).toEqual([PARTNER]);
    expect(msgs()[0].deliveredTo).toEqual([PARTNER]);
  });

  it("an unknown rumor kind and an unknown type tag are both dropped", async () => {
    await deliver({ kind: 1, content: "note?" });
    await deliver({ kind: 14, content: "??", tags: [["p", ME], ["type", "dm_future"]] });
    expect(msgs()).toHaveLength(1);
  });

  it("a rumor from a blocked (kind-10000 muted) pubkey never renders", async () => {
    store.dispatch(setMuteList({ mutes: [{ type: "pubkey", value: THIRD }], createdAt: 1 }));
    await deliver({ kind: 14, sender: THIRD, content: "spam", tags: [["p", ME]] });
    expect(store.getState().dm.messages[THIRD]).toBeUndefined();
  });

  it("a rumor p-tagging three people lands in a room keyed by the sorted participant set", async () => {
    await deliver({ kind: 14, sender: PARTNER, content: "hi all", tags: [["p", ME], ["p", THIRD]] });
    const roomId = [ME, PARTNER, THIRD].sort().join(",");
    const room = store.getState().dm.contacts.find((c) => c.pubkey === roomId);
    expect(room?.isRoom).toBe(true);
    expect([...(room?.participants ?? [])].sort()).toEqual([ME, PARTNER, THIRD].sort());
    expect(store.getState().dm.messages[roomId]?.[0].content).toBe("hi all");
  });

  it("an explicit g tag names the room and a subject titles it", async () => {
    await deliver({ kind: 14, sender: PARTNER, content: "yo", tags: [["p", ME], ["p", THIRD], ["g", "room-xyz"], ["subject", "Weekend"]] });
    const room = store.getState().dm.contacts.find((c) => c.pubkey === "room-xyz");
    expect(room?.subject).toBe("Weekend");
  });
});
