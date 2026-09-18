import { describe, it, expect } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { IngestContext, NostrEvent } from "../../src/workers/ingestHandlers.js";
import {
  planNotifications,
  preview,
  threadParentId,
  type PlanDeps,
} from "../../src/lib/notifications/planNotifications.js";

const ME = "a".repeat(64);
const ALICE = "b".repeat(64);
const BOB = "c".repeat(64);
const NOTE = "e".repeat(64);
const OTHER_NOTE = "f".repeat(64);

const own: IngestContext = { relayUrl: "ws://own", isOwnRelay: true, allowedSpaceIds: null };
const ext: IngestContext = { relayUrl: "wss://ext", isOwnRelay: false, allowedSpaceIds: new Set(["s1"]) };

function ev(over: Partial<NostrEvent>): NostrEvent {
  return {
    id: "1".repeat(64),
    pubkey: ALICE,
    created_at: 1_700_000_000,
    kind: 1,
    tags: [],
    content: "hey",
    sig: "sig",
    ...over,
  };
}

function deps(over: Partial<PlanDeps> = {}): PlanDeps {
  return {
    parentAuthorOf: (id) => (id === NOTE ? ME : undefined),
    notePreviewOf: (id) => (id === NOTE ? "my original note" : undefined),
    displayName: (pk) => (pk === ALICE ? "alice" : pk === BOB ? "bob" : pk.slice(0, 8)),
    spaceName: (id) => (id === "s1" ? "neon" : undefined),
    watchersOf: () => [],
    ...over,
  };
}

describe("threadParentId (NIP-10)", () => {
  it("prefers reply, then root, then the last positional e; ignores mention markers", () => {
    expect(threadParentId(ev({ tags: [["e", "r", "", "root"], ["e", "p", "", "reply"]] }))).toBe("p");
    expect(threadParentId(ev({ tags: [["e", "r", "", "root"]] }))).toBe("r");
    expect(threadParentId(ev({ tags: [["e", "x"], ["e", "y"]] }))).toBe("y");
    expect(threadParentId(ev({ tags: [["e", "m", "", "mention"]] }))).toBeUndefined();
    expect(threadParentId(ev({ tags: [] }))).toBeUndefined();
  });
});

describe("preview", () => {
  it("collapses entities, links and whitespace, and caps length", () => {
    expect(preview("yo nostr:npub1abc   check https://x.y/z\nnow")).toBe("yo @mention check [link] now");
    expect(preview("a".repeat(200)).length).toBe(120);
  });
});

describe("planNotifications", () => {
  it("never plans from an external relay", () => {
    expect(planNotifications(ev({ tags: [["p", ME]] }), ext, deps())).toEqual([]);
  });

  it("kind 1: reply when the parent is mine, mention otherwise; never the author", () => {
    const reply = ev({ tags: [["e", NOTE, "", "root"], ["p", ME], ["p", ALICE]], content: "nice" });
    const [r] = planNotifications(reply, own, deps());
    expect(r).toMatchObject({
      recipient: ME,
      type: "reply",
      title: "reply from alice",
      body: "nice",
      url: `soot://note/${NOTE}`,
      collapseKey: `activity:${ME}`,
    });
    expect(planNotifications(reply, own, deps())).toHaveLength(1);

    const mention = ev({ tags: [["e", OTHER_NOTE, "", "root"], ["p", ME]], content: "cc nostr:npub1zz" });
    const [m] = planNotifications(mention, own, deps());
    expect(m).toMatchObject({ type: "mention", title: "alice mentioned you", body: "cc @mention" });
    expect(m.url).toBe(`soot://note/${"1".repeat(64)}`);
  });

  it("kind 1: a top-level note fans out to watchers as a post, skipping tagged recipients", () => {
    const post = ev({ tags: [["p", ME]], content: "out friday" });
    const out = planNotifications(post, own, deps({ watchersOf: () => [ME, BOB, ALICE] }));
    expect(out.map((i) => [i.recipient, i.type])).toEqual([
      [ME, "mention"],
      [BOB, "post"],
    ]);
    expect(out[1]).toMatchObject({ title: "alice", body: "out friday", collapseKey: `release:${BOB}` });
    // A reply never fans out.
    const reply = ev({ tags: [["e", OTHER_NOTE, "", "root"]] });
    expect(planNotifications(reply, own, deps({ watchersOf: () => [BOB] }))).toEqual([]);
  });

  it("kind 1: a space-exclusive (h-tagged) note never fans out to watchers; explicit mentions still push", () => {
    const spacePost = ev({ tags: [["h", "s1"], ["p", ME]], content: "members only" });
    const out = planNotifications(spacePost, own, deps({ watchersOf: () => [BOB] }));
    expect(out.map((i) => [i.recipient, i.type])).toEqual([[ME, "mention"]]);
  });

  it("kind 7: reaction with the target's preview; needs an e tag", () => {
    const like = ev({ kind: 7, tags: [["e", NOTE], ["p", ME]], content: "+" });
    const [r] = planNotifications(like, own, deps());
    expect(r).toMatchObject({
      type: "reaction",
      title: "alice liked your note",
      body: "my original note",
      url: `soot://note/${NOTE}`,
    });
    const fire = ev({ kind: 7, tags: [["e", NOTE], ["p", ME]], content: "🔥" });
    expect(planNotifications(fire, own, deps())[0].title).toBe("alice reacted 🔥");
    expect(planNotifications(ev({ kind: 7, tags: [["p", ME]] }), own, deps())).toEqual([]);
  });

  it("kind 7: the preview is only for the target's author, and long content is not an emoji", () => {
    // BOB p-tagged on a note ME wrote: he gets the reaction push, no preview.
    const misdirected = ev({ kind: 7, tags: [["e", NOTE], ["p", BOB]], content: "+" });
    const [m] = planNotifications(misdirected, own, deps());
    expect(m).toMatchObject({ recipient: BOB, body: "" });

    // A kilobyte of "emoji" falls back to the liked title.
    const essay = ev({ kind: 7, tags: [["e", NOTE], ["p", ME]], content: "x".repeat(1000) });
    expect(planNotifications(essay, own, deps())[0].title).toBe("alice liked your note");
  });

  it("kind 9735: sats from the SIGNED 9734 requester; self-zaps and unsettled receipts are silent", () => {
    const bobSk = generateSecretKey();
    const bobPk = getPublicKey(bobSk);
    const req = finalizeEvent(
      { kind: 9734, created_at: 1_700_000_000, content: "great set", tags: [["amount", "21000"], ["p", ME]] },
      bobSk,
    );
    const zap = ev({
      kind: 9735,
      pubkey: "d".repeat(64), // the LNURL server key
      tags: [["p", ME], ["e", NOTE], ["bolt11", "lnbc..."], ["description", JSON.stringify(req)]],
    });
    const zapDeps = deps({ displayName: (pk) => (pk === bobPk ? "bob" : pk.slice(0, 8)) });
    const [z] = planNotifications(zap, own, zapDeps);
    expect(z).toMatchObject({
      recipient: ME,
      type: "zap",
      title: "21 sats from bob",
      body: "great set",
      url: `soot://note/${NOTE}`,
      data: { actor: bobPk, sats: 21 },
    });
    const selfReq = finalizeEvent(
      { kind: 9734, created_at: 1_700_000_000, content: "", tags: [["amount", "21000"], ["p", bobPk]] },
      bobSk,
    );
    const self = { ...zap, tags: [["p", bobPk], ["bolt11", "lnbc..."], ["description", JSON.stringify(selfReq)]] };
    expect(planNotifications(self, own, zapDeps)).toEqual([]);
    const unpaid = { ...zap, tags: zap.tags.filter((t) => t[0] !== "bolt11") };
    expect(planNotifications(unpaid, own, zapDeps)).toEqual([]);
  });

  it("kind 9735: a forged receipt cannot attribute a zap to a key it doesn't control", () => {
    // The classic fake: unsigned description JSON naming someone else's pubkey.
    const forged = ev({
      kind: 9735,
      pubkey: "d".repeat(64),
      tags: [
        ["p", ME],
        ["bolt11", "x"],
        ["description", JSON.stringify({ pubkey: BOB, content: "payment sent as agreed", tags: [["amount", "50000000000"]] })],
      ],
    });
    expect(planNotifications(forged, own, deps())).toEqual([]);

    // A signed 9734 whose signature doesn't verify (tampered pubkey) is also silent.
    const sk = generateSecretKey();
    const signed = finalizeEvent(
      { kind: 9734, created_at: 1_700_000_000, content: "", tags: [["amount", "21000"]] },
      sk,
    );
    const tampered = { ...signed, pubkey: BOB };
    const spoofed = ev({
      kind: 9735,
      pubkey: "d".repeat(64),
      tags: [["p", ME], ["bolt11", "x"], ["description", JSON.stringify(tampered)]],
    });
    expect(planNotifications(spoofed, own, deps())).toEqual([]);

    // The bare P-tag fallback is gone: a receipt with only a P tag is silent.
    const pOnly = ev({
      kind: 9735,
      pubkey: "d".repeat(64),
      tags: [["p", ME], ["P", BOB], ["bolt11", "x"]],
    });
    expect(planNotifications(pOnly, own, deps())).toEqual([]);
  });

  it("kind 9: a space mention deep-links to the channel and names the space", () => {
    const chat = ev({ kind: 9, tags: [["h", "s1"], ["channel", "general"], ["p", ME]], content: "yo" });
    const [c] = planNotifications(chat, own, deps());
    expect(c).toMatchObject({
      type: "chat",
      title: "alice in neon",
      body: "yo",
      url: "soot://space/s1/channel/general",
      collapseKey: `space:s1:${ME}`,
    });
    const untagged = ev({ kind: 9, tags: [["h", "s1"], ["p", ME]] });
    expect(planNotifications(untagged, own, deps())[0].url).toBe("soot://space/s1");
    expect(planNotifications(ev({ kind: 9, tags: [["h", "s1"]] }), own, deps())).toEqual([]);
  });

  it("kind 1059: content-free 'new message' for the recipient only", () => {
    const wrap = ev({ kind: 1059, pubkey: "9".repeat(64), tags: [["p", ME]], content: "ciphertext" });
    const [d] = planNotifications(wrap, own, deps());
    expect(d).toEqual({
      recipient: ME,
      type: "dm",
      title: "soot",
      body: "new message",
      url: "soot://dm?segment=messages",
      collapseKey: `dm:${ME}`,
      data: { eventId: "1".repeat(64) },
    });
    expect(JSON.stringify(d)).not.toContain("ciphertext");
  });

  it("releases fan out to watchers with the public title; private ones never", () => {
    const track = ev({ kind: 31683, tags: [["d", "midnight"], ["title", "Midnight"], ["p", BOB]] });
    const out = planNotifications(track, own, deps({ watchersOf: () => [ME, BOB] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      recipient: ME,
      type: "release",
      title: "alice",
      body: "new track: Midnight",
      url: `soot://music/track/31683:${ALICE}:midnight`,
      collapseKey: `release:${ME}`,
    });
    const album = ev({ kind: 33123, tags: [["d", "lp"], ["title", "LP"]] });
    expect(planNotifications(album, own, deps({ watchersOf: () => [ME] }))[0]).toMatchObject({
      body: "new project: LP",
      url: `soot://music/album/33123:${ALICE}:lp`,
    });
    const priv = ev({ kind: 31683, tags: [["d", "x"], ["visibility", "private"]] });
    expect(planNotifications(priv, own, deps({ watchersOf: () => [ME] }))).toEqual([]);
    // Space-exclusive (h-tagged) releases are as silent as private ones.
    const scoped = ev({ kind: 31683, tags: [["d", "x"], ["title", "X"], ["h", "s1"]] });
    expect(planNotifications(scoped, own, deps({ watchersOf: () => [ME] }))).toEqual([]);
    expect(planNotifications(ev({ kind: 31683, tags: [] }), own, deps({ watchersOf: () => [ME] }))).toEqual([]);
  });

  it("other kinds are silent", () => {
    for (const kind of [0, 3, 5, 6, 30023]) {
      expect(planNotifications(ev({ kind, tags: [["p", ME]] }), own, deps())).toEqual([]);
    }
  });
});
