import { describe, it, expect } from "vitest";
import { generateSecretKey, getPublicKey, nip44 } from "nostr-tools";
import type { NostrEvent } from "@/types/nostr";
import type { MusicProposal } from "@/types/music";
import {
  accessStateFor,
  grantViewerOnEvent,
  looksLikeNip44,
  ownedChildTrackRefs,
  planGrant,
  type GrantCrypto,
} from "../accessGrant";
import { collapseListenRequests, groupByRelease, mutedPubkeys } from "../listenRequestInbox";

const ME = "a".repeat(64);
const REQ = "c".repeat(64);
const OTHER = "d".repeat(64);
const NOW = 1_800_000_000;
// Base64 of a 0x02-version payload of the minimum length.
const FAKE_CIPHERTEXT = "AgAA" + "A".repeat(128);

const fakeCrypto: GrantCrypto = {
  decryptSelf: async (c) => {
    if (c !== FAKE_CIPHERTEXT) throw new Error("bad mac");
    return '{"title":"Secret"}';
  },
  encryptFor: async (r, p) => `enc:${r}:${p}`,
};

function ev(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "id-" + Math.random().toString(36).slice(2),
    pubkey: ME,
    created_at: 1_700_000_000,
    kind: 31683,
    tags: [["d", "spiral"], ["title", "Spiral"], ["visibility", "private"]],
    content: "",
    sig: "0".repeat(128),
    ...overrides,
  };
}

describe("grantViewerOnEvent", () => {
  it("appends a collaborator p-tag to a cleartext private event and keeps everything else", async () => {
    const prev = ev({ tags: [["d", "spiral"], ["p", OTHER, "", "featured"], ["visibility", "private"], ["imeta", "url x"]] });
    const out = await grantViewerOnEvent(prev, REQ, fakeCrypto, NOW);
    expect(out).not.toBeNull();
    expect(out!.tags).toEqual([...prev.tags, ["p", REQ, "", "collaborator"]]);
    expect(out!.content).toBe("");
    expect(out!.kind).toBe(31683);
    expect(out!.pubkey).toBe(ME);
    expect(out!.created_at).toBe(NOW);
  });

  it("adds a per-viewer encrypted copy on the NIP-44 private form", async () => {
    const prev = ev({ content: FAKE_CIPHERTEXT });
    const out = await grantViewerOnEvent(prev, REQ, fakeCrypto, NOW);
    expect(out!.content).toBe(FAKE_CIPHERTEXT);
    expect(out!.tags.slice(-2)).toEqual([
      ["p", REQ, "", "collaborator"],
      ["encrypted_content", `enc:${REQ}:{"title":"Secret"}`, REQ],
    ]);
  });

  it("treats undecryptable cleartext content (soot description) as p-tag only", async () => {
    const prev = ev({ content: "a demo from the basement" });
    const out = await grantViewerOnEvent(prev, REQ, fakeCrypto, NOW);
    expect(out!.tags[out!.tags.length - 1]).toEqual(["p", REQ, "", "collaborator"]);
    expect(out!.tags.some((t) => t[0] === "encrypted_content")).toBe(false);
  });

  it("aborts when real-looking ciphertext won't decrypt", async () => {
    const prev = ev({ content: "AgAB" + "B".repeat(128) });
    await expect(grantViewerOnEvent(prev, REQ, fakeCrypto, NOW)).rejects.toThrow(/decrypt/);
  });

  it("is a no-op for the author and for an existing grant", async () => {
    expect(await grantViewerOnEvent(ev(), ME, fakeCrypto, NOW)).toBeNull();
    const granted = ev({ tags: [["d", "spiral"], ["visibility", "private"], ["p", REQ, "", "collaborator"]] });
    expect(await grantViewerOnEvent(granted, REQ, fakeCrypto, NOW)).toBeNull();
    const legacy = ev({ tags: [["d", "spiral"], ["visibility", "private"], ["p", REQ]] });
    expect(await grantViewerOnEvent(legacy, REQ, fakeCrypto, NOW)).toBeNull();
  });

  it("a featured credit is not access: adds the viewer tag alongside it", async () => {
    const prev = ev({ tags: [["d", "spiral"], ["visibility", "private"], ["p", REQ, "", "featured"]] });
    const out = await grantViewerOnEvent(prev, REQ, fakeCrypto, NOW);
    expect(out!.tags.filter((t) => t[0] === "p" && t[1] === REQ)).toEqual([
      ["p", REQ, "", "featured"],
      ["p", REQ, "", "collaborator"],
    ]);
  });

  it("repairs a missing encrypted copy for an already-tagged viewer", async () => {
    const prev = ev({ content: FAKE_CIPHERTEXT, tags: [["d", "spiral"], ["visibility", "private"], ["p", REQ, "", "collaborator"]] });
    const out = await grantViewerOnEvent(prev, REQ, fakeCrypto, NOW);
    expect(out!.tags.length).toBe(prev.tags.length + 1);
    expect(out!.tags[out!.tags.length - 1]?.[0]).toBe("encrypted_content");
  });

  it("always out-dates the previous version", async () => {
    const out = await grantViewerOnEvent(ev({ created_at: NOW + 50 }), REQ, fakeCrypto, NOW);
    expect(out!.created_at).toBe(NOW + 51);
  });

  it("round-trips with real NIP-44 so the new viewer can decrypt", async () => {
    const ownerSk = generateSecretKey();
    const viewerSk = generateSecretKey();
    const owner = getPublicKey(ownerSk);
    const viewer = getPublicKey(viewerSk);
    const plaintext = JSON.stringify({ title: "Spiral", audioUrl: "https://x/a.mp3" });
    const selfKey = nip44.v2.utils.getConversationKey(ownerSk, owner);
    const content = nip44.v2.encrypt(plaintext, selfKey);
    expect(looksLikeNip44(content)).toBe(true);
    const crypto: GrantCrypto = {
      decryptSelf: async (c) => nip44.v2.decrypt(c, selfKey),
      encryptFor: async (r, p) => nip44.v2.encrypt(p, nip44.v2.utils.getConversationKey(ownerSk, r)),
    };
    const out = await grantViewerOnEvent(ev({ pubkey: owner, content }), viewer, crypto, NOW);
    const copy = out!.tags.find((t) => t[0] === "encrypted_content" && t[2] === viewer)!;
    expect(nip44.v2.decrypt(copy[1], nip44.v2.utils.getConversationKey(viewerSk, owner))).toBe(plaintext);
  });
});

describe("planGrant", () => {
  const project = ev({
    kind: 33123,
    tags: [
      ["d", "lp"],
      ["visibility", "private"],
      ["a", `31683:${ME}:one`],
      ["a", `31683:${OTHER}:theirs`],
      ["a", `31683:${ME}:two`],
      ["a", `31683:${ME}:one`],
    ],
  });

  it("pushes the viewer onto every owned child that lacks it", async () => {
    const one = ev({ tags: [["d", "one"], ["visibility", "private"]] });
    const twoOld = ev({ tags: [["d", "two"], ["visibility", "private"]], created_at: 10 });
    const twoNew = ev({ tags: [["d", "two"], ["visibility", "private"], ["p", REQ, "", "collaborator"]], created_at: 20 });
    const theirs = ev({ pubkey: OTHER, tags: [["d", "theirs"], ["visibility", "private"]] });
    const plan = await planGrant({ target: project, requester: REQ, me: ME, childTracks: [one, twoOld, twoNew, theirs], crypto: fakeCrypto, now: NOW });
    expect(plan.map((u) => u.tags.find((t) => t[0] === "d")?.[1])).toEqual(["lp", "one"]);
    expect(ownedChildTrackRefs(project)).toEqual([`31683:${ME}:one`, `31683:${ME}:two`]);
  });

  it("leaves public and space children alone", async () => {
    const pub = ev({ tags: [["d", "one"]] });
    const space = ev({ tags: [["d", "two"], ["h", "space1"]] });
    const plan = await planGrant({ target: project, requester: REQ, me: ME, childTracks: [pub, space], crypto: fakeCrypto, now: NOW });
    expect(plan.map((u) => u.tags.find((t) => t[0] === "d")?.[1])).toEqual(["lp"]);
  });

  it("grants a private space event to a space member (p-tag still needed)", async () => {
    const target = ev({ tags: [["d", "x"], ["h", "space1"], ["visibility", "private"]] });
    expect(await planGrant({ target, requester: REQ, me: ME, crypto: fakeCrypto, now: NOW })).toEqual([]);
    const plan = await planGrant({ target, requester: REQ, me: ME, crypto: fakeCrypto, isSpaceMember: (ids) => ids.includes("space1"), now: NOW });
    expect(plan[0].tags[plan[0].tags.length - 1]).toEqual(["p", REQ, "", "collaborator"]);
  });

  it("is empty when nothing needs changing, and refuses a foreign target", async () => {
    const granted = ev({ tags: [["d", "spiral"], ["visibility", "private"], ["p", REQ, "", "collaborator"]] });
    expect(await planGrant({ target: granted, requester: REQ, me: ME, crypto: fakeCrypto })).toEqual([]);
    await expect(planGrant({ target: ev({ pubkey: OTHER }), requester: REQ, me: ME, crypto: fakeCrypto })).rejects.toThrow();
  });
});

describe("accessStateFor", () => {
  it("classifies public, space, granted and needs-grant", () => {
    expect(accessStateFor(ev({ tags: [["d", "x"]] }), REQ)).toBe("public");
    expect(accessStateFor(ev({ tags: [["d", "x"], ["h", "space1"]] }), REQ)).toBe("space");
    expect(accessStateFor(ev({ tags: [["d", "x"], ["h", "space1"]] }), REQ, { spaceMember: true })).toBe("has-access");
    expect(accessStateFor(ev({ tags: [["d", "x"], ["h", "s"], ["visibility", "private"]] }), REQ, { spaceMember: true })).toBe("needs-grant");
    expect(accessStateFor(ev(), ME)).toBe("has-access");
    expect(accessStateFor(ev(), REQ)).toBe("needs-grant");
    expect(accessStateFor(ev({ tags: [["d", "x"], ["visibility", "private"], ["p", REQ, "", "artist"]] }), REQ)).toBe("has-access");
    expect(accessStateFor(ev({ tags: [["d", "x"], ["visibility", "private"], ["p", REQ, "", "featured"]] }), REQ)).toBe("needs-grant");
    // Tagged but missing their decryptable copy of an encrypted event.
    expect(accessStateFor(ev({ content: FAKE_CIPHERTEXT, tags: [["d", "x"], ["visibility", "private"], ["p", REQ, "", "collaborator"]] }), REQ)).toBe("needs-grant");
  });
});

function row(id: string, proposer: string, target: string, createdAt: number, extra: Partial<MusicProposal> = {}): MusicProposal {
  return {
    id,
    proposalId: "req-x",
    targetAlbum: target,
    proposerPubkey: proposer,
    ownerPubkey: ME,
    title: "listen request",
    changes: [{ type: "grant_access", role: "viewer" }],
    status: "open",
    createdAt,
    ...extra,
  };
}

describe("collapseListenRequests", () => {
  const T1 = `31683:${ME}:spiral`;
  const T2 = `33123:${ME}:lp`;

  it("collapses duplicates per requester+target, keeping the newest and every row id", () => {
    const groups = collapseListenRequests(
      [row("r1", REQ, T1, 100), row("r2", REQ, T1, 300), row("r3", REQ, T1, 200), row("r4", OTHER, T1, 150)],
      { me: ME },
    );
    expect(groups.map((g) => g.key)).toEqual([`${REQ}|${T1}`, `${OTHER}|${T1}`]);
    expect(groups[0].latest.id).toBe("r2");
    expect(groups[0].rowIds).toEqual(["r2", "r3", "r1"]);
    expect(groups[0].createdAt).toBe(300);
  });

  it("drops muted requesters, tracklist proposals, resolved rows, foreign owners and self-asks", () => {
    const muted = mutedPubkeys([
      { type: "pubkey", value: OTHER },
      { type: "word", value: REQ },
    ]);
    const groups = collapseListenRequests(
      [
        row("keep", REQ, T1, 1),
        row("muted", OTHER, T1, 2),
        row("tracklist", REQ, T2, 3, { changes: [{ type: "reorder", from: 0, to: 1 }] }),
        row("done", REQ, T2, 4, { status: "rejected" }),
        row("foreign", REQ, T2, 5, { ownerPubkey: OTHER }),
        row("self", ME, T2, 6),
      ],
      { me: ME, muted },
    );
    expect(groups.map((g) => g.latest.id)).toEqual(["keep"]);
  });

  it("groupByRelease buckets per target, newest release first", () => {
    const groups = collapseListenRequests([row("a", REQ, T1, 10), row("b", OTHER, T2, 30), row("c", OTHER, T1, 20)], { me: ME });
    const releases = groupByRelease(groups);
    expect(releases.map((r) => r.targetRef)).toEqual([T2, T1]);
    expect(releases[1].groups.map((g) => g.latest.id)).toEqual(["c", "a"]);
  });
});
