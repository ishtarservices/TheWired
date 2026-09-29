/**
 * Gift-wrap → pipeline routing for the E2EE call contract
 * (docs/E2EE_CALLS.md, docs/DM_WIRE_CONTRACT.md §2):
 *
 *  - a `call_invite` with `caps.e2ee` rings and carries the capability;
 *  - one without it (outdated caller) never rings: it is declined and a
 *    "peer outdated" notice is raised;
 *  - a kind-20016 media_key rumor is handed to the E2EE inbox and never
 *    rendered as a message.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NostrEvent } from "@/types/nostr";

const mockUnwrap = vi.fn();
vi.mock("@/lib/nostr/giftWrap", () => ({
  unwrapGiftWrap: (...a: unknown[]) => mockUnwrap(...a),
}));
vi.mock("@/lib/nostr/dmSignals", () => ({ queueDeliveredReceipt: vi.fn() }));
const mockDecline = vi.fn(async (_pk: string) => {});
vi.mock("@/features/calling/callService", () => ({
  declineLegacyInvite: (pk: string) => mockDecline(pk),
}));
const mockDeliver = vi.fn(() => true);
vi.mock("@/lib/webrtc/e2ee/mediaKeyInbox", () => ({
  deliverMediaKey: (...a: unknown[]) => mockDeliver(...(a as [])),
}));

import { processIncomingEvent, resetEventPipelineCaches } from "../eventPipeline";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";

const WS = "wss://relay.example";
const ME = "a".repeat(64);
const PARTNER = "b".repeat(64);
const SECRET = "01".repeat(32);
const hex64 = (n: number) => n.toString(16).padStart(64, "0");

let wrapCounter = 500;
function wrap(): NostrEvent {
  const id = ++wrapCounter;
  return {
    id: hex64(id),
    pubkey: hex64(0xbeef + id),
    created_at: Math.floor(Date.now() / 1000) - 5,
    kind: 1059,
    tags: [["p", ME]],
    content: "ciphertext",
    sig: "0".repeat(128),
  };
}

async function deliver(r: { kind: number; content: string; tags?: string[][]; sender?: string }) {
  const w = wrap();
  mockUnwrap.mockResolvedValueOnce({
    sender: r.sender ?? PARTNER,
    content: r.content,
    tags: r.tags ?? [["p", ME]],
    createdAt: Math.floor(Date.now() / 1000) - 2,
    wrapId: w.id,
    rumorId: hex64(0xf000 + wrapCounter),
    kind: r.kind,
  });
  await processIncomingEvent(w, WS);
  await new Promise((res) => setTimeout(res, 0));
  return w;
}

const invite = (extra: Record<string, unknown>) =>
  JSON.stringify({ roomSecretKey: SECRET, callType: "audio", callerName: PARTNER, transport: "sfu", ...extra });

beforeEach(() => {
  store.dispatch(resetAll());
  resetEventPipelineCaches();
  mockUnwrap.mockReset();
  mockDecline.mockClear();
  mockDeliver.mockClear();
  store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
});

describe("call_invite capability gate", () => {
  it("rings for an invite that advertises e2ee, keeping the capability on the invite", async () => {
    await deliver({ kind: 14, content: invite({ caps: { e2ee: true } }), tags: [["p", ME], ["type", "call_invite"]] });
    const incoming = store.getState().call.incomingCall;
    expect(incoming).toMatchObject({ callerPubkey: PARTNER, roomSecretKey: SECRET, caps: { e2ee: true } });
    expect(mockDecline).not.toHaveBeenCalled();
    expect(store.getState().call.notice).toBeNull();
  });

  it("never rings for a legacy invite: declines it and raises the outdated-peer notice", async () => {
    await deliver({ kind: 14, content: invite({}), tags: [["p", ME], ["type", "call_invite"]] });
    expect(store.getState().call.incomingCall).toBeNull();
    await vi.waitFor(() => expect(mockDecline).toHaveBeenCalledWith(PARTNER));
  });

  it("treats caps.e2ee=false (or a mobile invite without callerName) as legacy too", async () => {
    await deliver({
      kind: 14,
      content: JSON.stringify({ roomSecretKey: SECRET, callType: "audio", caps: { e2ee: false } }),
      tags: [["p", ME], ["type", "call_invite"]],
    });
    expect(store.getState().call.incomingCall).toBeNull();
    await vi.waitFor(() => expect(mockDecline).toHaveBeenCalledTimes(1));
  });

  it("ignores our own outgoing invite echo (self-wrap)", async () => {
    await deliver({ kind: 14, content: invite({}), tags: [["p", PARTNER], ["type", "call_invite"]], sender: ME });
    expect(mockDecline).not.toHaveBeenCalled();
    expect(store.getState().call.incomingCall).toBeNull();
  });
});

describe("media_key routing", () => {
  const envelope = { v: 1, room: "s:c", keys: [{ idx: 0, key: "0a".repeat(32) }], ts: Date.now() };

  it("hands a kind-20016 rumor to the E2EE inbox with the sender and wrap id, and renders nothing", async () => {
    const w = await deliver({ kind: 20016, content: JSON.stringify(envelope) });
    expect(mockDeliver).toHaveBeenCalledWith(PARTNER, envelope, w.id);
    expect(store.getState().dm.messages[PARTNER] ?? []).toHaveLength(0);
  });

  it("drops our own media_key echoes and malformed envelopes", async () => {
    await deliver({ kind: 20016, content: JSON.stringify(envelope), sender: ME, tags: [["p", PARTNER]] });
    await deliver({ kind: 20016, content: '{"v":1}' });
    expect(mockDeliver).not.toHaveBeenCalled();
  });
});
