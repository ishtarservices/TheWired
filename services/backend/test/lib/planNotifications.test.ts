import { describe, it, expect } from "vitest";
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

  it("kind 9735: sats from the 9734 requester; self-zaps and unsettled receipts are silent", () => {
    const req = { pubkey: BOB, content: "great set", tags: [["amount", "21000"]] };
    const zap = ev({
      kind: 9735,
      pubkey: "d".repeat(64), // the LNURL server key
      tags: [["p", ME], ["e", NOTE], ["bolt11", "lnbc..."], ["description", JSON.stringify(req)]],
    });
    const [z] = planNotifications(zap, own, deps());
    expect(z).toMatchObject({
      recipient: ME,
      type: "zap",
      title: "21 sats from bob",
      body: "great set",
      url: `soot://note/${NOTE}`,
      data: { actor: BOB, sats: 21 },
    });
    const self = { ...zap, tags: zap.tags.map((t) => (t[0] === "description" ? ["description", JSON.stringify({ ...req, pubkey: ME })] : t)) };
    expect(planNotifications(self, own, deps())).toEqual([]);
    const unpaid = { ...zap, tags: zap.tags.filter((t) => t[0] !== "bolt11") };
    expect(planNotifications(unpaid, own, deps())).toEqual([]);
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
      url: "soot://dm",
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
    expect(planNotifications(ev({ kind: 31683, tags: [] }), own, deps({ watchersOf: () => [ME] }))).toEqual([]);
  });

  it("other kinds are silent", () => {
    for (const kind of [0, 3, 5, 6, 30023]) {
      expect(planNotifications(ev({ kind, tags: [["p", ME]] }), own, deps())).toEqual([]);
    }
  });
});
