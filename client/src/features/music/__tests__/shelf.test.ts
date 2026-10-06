/**
 * Music channel shelf (WIR-146, soot parity): kind-9 posts into a channel merge
 * with members' releases; attribution attaches instead of duplicating; private
 * releases never show; "All" folds tracks into their project.
 */
import { describe, it, expect } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import type { MusicAlbum, MusicTrack } from "@/types/music";
import { lunaVega, marcusCole } from "@/__tests__/fixtures/testUsers";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { buildTrackEvent, buildAlbumEvent } from "../musicEventBuilder";
import {
  buildShelf,
  collapseMemberTracks,
  parseMusicChannelPost,
  pendingRefs,
  shelfTrackIds,
  sortShelfNewest,
  isReleaseAllowedInSpace,
} from "../shelf";
import { buildMusicChannelPost, buildMusicChannelPostEvent, releaseShareBlockReason } from "../musicChannelPost";
import { matchMusicEmbed, externalMediaKey } from "@/lib/content/musicEmbeds";

const SPACE = "4875c1deed7e";
const CHANNEL = "6S4FjZBSN7sP";

function signed(unsigned: ReturnType<typeof buildTrackEvent>, id: string, createdAt?: number): NostrEvent {
  return { ...unsigned, id, sig: "0".repeat(128), created_at: createdAt ?? unsigned.created_at };
}
function track(slug: string, opts: Partial<Parameters<typeof buildTrackEvent>[1]> = {}, createdAt = 1_700_000_000): MusicTrack {
  return parseTrackEvent(signed(buildTrackEvent(lunaVega.pubkey, { title: slug, artist: "Luna", slug, audioUrl: "https://x/a.mp3", ...opts }), `t-${slug}`, createdAt));
}
function album(slug: string, trackRefs: string[] = [], opts: Partial<Parameters<typeof buildAlbumEvent>[1]> = {}, createdAt = 1_700_000_000): MusicAlbum {
  return parseAlbumEvent(signed(buildAlbumEvent(lunaVega.pubkey, { title: slug, artist: "Luna", slug, trackRefs, ...opts }), `a-${slug}`, createdAt));
}
function post(pubkey: string, content: string, tags: string[][], createdAt: number, id = `p-${createdAt}`): NostrEvent {
  return { id, pubkey, kind: 9, created_at: createdAt, content, tags: [["h", SPACE], ["channel", CHANNEL], ...tags], sig: "0".repeat(128) };
}

describe("parseMusicChannelPost", () => {
  const t = track("spiral");

  it("reads a release post from its a/k tags and separates the note", () => {
    const body = buildMusicChannelPost({ kind: "track", track: t }, { note: "banger", posterPubkey: marcusCole.pubkey });
    const ev = post(marcusCole.pubkey, body.content, body.tags, 10);
    expect(body.tags).toEqual([["a", t.addressableId], ["k", "31683"], ["p", lunaVega.pubkey, "", "artist"]]);
    expect(body.content.startsWith("nostr:naddr1")).toBe(true);
    expect(parseMusicChannelPost(ev)).toEqual({ ref: t.addressableId, note: "banger" });
  });

  it("omits the artist p-tag when the poster is the author", () => {
    const body = buildMusicChannelPost({ kind: "track", track: t }, { posterPubkey: lunaVega.pubkey });
    expect(body.tags.some((x) => x[0] === "p")).toBe(false);
  });

  it("reads a provider link from the r tag with the canonical url", () => {
    const media = matchMusicEmbed("https://youtu.be/dQw4w9WgXcQ?t=1")!;
    const body = buildMusicChannelPost({ kind: "external", media }, { note: "classic", posterPubkey: marcusCole.pubkey });
    expect(body.tags).toEqual([["r", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]]);
    const parsed = parseMusicChannelPost(post(marcusCole.pubkey, body.content, body.tags, 10));
    expect(parsed?.media?.canonicalUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(parsed?.note).toBe("classic");
  });

  it("falls back to a bare naddr or a pasted provider link in the content", () => {
    const body = buildMusicChannelPost({ kind: "track", track: t }, { posterPubkey: marcusCole.pubkey });
    expect(parseMusicChannelPost(post(marcusCole.pubkey, body.content, [], 10))).toEqual({ ref: t.addressableId, note: "" });
    const pasted = parseMusicChannelPost(post(marcusCole.pubkey, "listen https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=x", [], 10));
    expect(pasted?.media?.canonicalUrl).toBe("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC");
    expect(pasted?.note).toBe("listen");
  });

  it("ignores ordinary chat messages and non-music refs", () => {
    expect(parseMusicChannelPost(post(marcusCole.pubkey, "hello", [], 10))).toBeNull();
    expect(parseMusicChannelPost(post(marcusCole.pubkey, "x", [["a", `30023:${lunaVega.pubkey}:article`]], 10))).toBeNull();
    expect(parseMusicChannelPost({ ...post(marcusCole.pubkey, "x", [["a", t.addressableId]], 10), kind: 1 })).toBeNull();
  });

  it("the full event carries h + channel from the chat builder plus the post tags", () => {
    const ev = buildMusicChannelPostEvent(marcusCole.pubkey, SPACE, CHANNEL, { kind: "track", track: t }, "note");
    expect(ev.kind).toBe(9);
    expect(ev.tags).toEqual(expect.arrayContaining([["h", SPACE], ["channel", CHANNEL], ["a", t.addressableId], ["k", "31683"]]));
    expect(ev.content.endsWith("\n\nnote")).toBe(true);
  });
});

describe("buildShelf", () => {
  const t1 = track("one", {}, 100);
  const t2 = track("two", {}, 200);
  const ep = album("ep", [t1.addressableId, t2.addressableId], {}, 150);

  it("lists the feed leg with no attribution", () => {
    const rows = buildShelf({ tracks: [t1, t2], albums: [ep], posts: [], resolvedTracks: {}, resolvedAlbums: {}, spaceId: SPACE });
    expect(rows.map((r) => r.key)).toEqual([t1.addressableId, t2.addressableId, ep.addressableId]);
    expect(rows.every((r) => r.postedBy.length === 0)).toBe(true);
  });

  it("a post of a listed release attaches attribution and bumps the sort anchor", () => {
    const body = buildMusicChannelPost({ kind: "track", track: t1 }, { note: "fav", posterPubkey: marcusCole.pubkey });
    const rows = buildShelf({ tracks: [t1, t2], albums: [], posts: [post(marcusCole.pubkey, body.content, body.tags, 500)], resolvedTracks: {}, resolvedAlbums: {}, spaceId: SPACE });
    expect(rows).toHaveLength(2);
    const row = rows.find((r) => r.key === t1.addressableId)!;
    expect(row.postedBy).toEqual([{ pubkey: marcusCole.pubkey, at: 500, eventId: "p-500", note: "fav" }]);
    expect(row.at).toBe(500);
    expect(sortShelfNewest(rows)[0].key).toBe(t1.addressableId);
  });

  it("a post of an unlisted release resolves from the catalog, else stays pending", () => {
    const body = buildMusicChannelPost({ kind: "track", track: t2 }, { posterPubkey: marcusCole.pubkey });
    const posts = [post(marcusCole.pubkey, body.content, body.tags, 300)];
    const resolved = buildShelf({ tracks: [t1], albums: [], posts, resolvedTracks: { [t2.addressableId]: t2 }, resolvedAlbums: {}, spaceId: SPACE });
    expect(resolved.find((r) => r.key === t2.addressableId)?.kind).toBe("track");
    const unresolved = buildShelf({ tracks: [t1], albums: [], posts, resolvedTracks: {}, resolvedAlbums: {}, spaceId: SPACE });
    expect(unresolved.find((r) => r.key === t2.addressableId)?.kind).toBe("pending");
    expect(pendingRefs(unresolved)).toEqual([t2.addressableId]);
  });

  it("two posts of the same provider link collapse to one external row", () => {
    const a = post(marcusCole.pubkey, "https://youtu.be/dQw4w9WgXcQ", [["r", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]], 10, "pa");
    const b = post(lunaVega.pubkey, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5\n\nagain", [["r", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"]], 20, "pb");
    const rows = buildShelf({ tracks: [], albums: [], posts: [b, a], resolvedTracks: {}, resolvedAlbums: {}, spaceId: SPACE });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(externalMediaKey("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    expect(rows[0].postedBy.map((p) => p.eventId)).toEqual(["pa", "pb"]); // oldest first
    expect(rows[0].postedBy[1].note).toBe("again");
  });

  it("drops private releases from both legs and other-space exclusives from posts", () => {
    const priv = track("secret", { visibility: "private" });
    const other = track("elsewhere", { visibility: "space", spaceId: "other-space" });
    const body = buildMusicChannelPost({ kind: "track", track: other }, { posterPubkey: marcusCole.pubkey });
    const rows = buildShelf({
      tracks: [priv, t1], albums: [], posts: [post(marcusCole.pubkey, body.content, body.tags, 10)],
      resolvedTracks: { [other.addressableId]: other }, resolvedAlbums: {}, spaceId: SPACE,
    });
    expect(rows.map((r) => r.key)).toEqual([t1.addressableId]);
    expect(isReleaseAllowedInSpace(track("here", { visibility: "space", spaceId: SPACE }), SPACE)).toBe(true);
  });

  it("skips posts from muted authors and removed posts", () => {
    const body = buildMusicChannelPost({ kind: "track", track: t1 }, { posterPubkey: marcusCole.pubkey });
    const p = post(marcusCole.pubkey, body.content, body.tags, 10);
    const muted = buildShelf({ tracks: [], albums: [], posts: [p], resolvedTracks: { [t1.addressableId]: t1 }, resolvedAlbums: {}, muted: new Set([marcusCole.pubkey]) });
    expect(muted).toHaveLength(0);
    const removed = buildShelf({ tracks: [], albums: [], posts: [p], resolvedTracks: { [t1.addressableId]: t1 }, resolvedAlbums: {}, removedPosts: { [p.id]: true } });
    expect(removed).toHaveLength(0);
  });

  it("collapseMemberTracks folds a track into its listed project but keeps posted tracks and loose singles", () => {
    const t1InEp = parseTrackEvent(signed(buildTrackEvent(lunaVega.pubkey, { title: "one", artist: "Luna", slug: "one", audioUrl: "https://x/a.mp3", albumRef: ep.addressableId }), "t-one", 100));
    const t2InEp = parseTrackEvent(signed(buildTrackEvent(lunaVega.pubkey, { title: "two", artist: "Luna", slug: "two", audioUrl: "https://x/a.mp3", albumRef: ep.addressableId }), "t-two", 200));
    const single = track("single", {}, 300);
    const body = buildMusicChannelPost({ kind: "track", track: t2InEp }, { posterPubkey: marcusCole.pubkey });
    const rows = buildShelf({ tracks: [t1InEp, t2InEp, single], albums: [ep], posts: [post(marcusCole.pubkey, body.content, body.tags, 400)], resolvedTracks: {}, resolvedAlbums: {}, spaceId: SPACE });
    const all = collapseMemberTracks(rows);
    expect(all.map((r) => r.key)).toEqual([t2InEp.addressableId, single.addressableId, ep.addressableId]);
    // Play-all still queues every track.
    expect(shelfTrackIds(rows)).toEqual([t1InEp.addressableId, t2InEp.addressableId, single.addressableId]);
    // Without a listed project nothing folds.
    expect(collapseMemberTracks(rows.filter((r) => r.kind !== "album"))).toHaveLength(3);
  });
});

describe("releaseShareBlockReason", () => {
  it("blocks private / local / other-space releases and allows public + this-space ones", () => {
    expect(releaseShareBlockReason(track("p", { visibility: "private" }), SPACE)).toBe("private");
    expect(releaseShareBlockReason(track("o", { visibility: "space", spaceId: "other" }), SPACE)).toBe("another space only");
    expect(releaseShareBlockReason(track("s", { visibility: "space", spaceId: SPACE }), SPACE)).toBeNull();
    expect(releaseShareBlockReason(track("pub"), SPACE)).toBeNull();
  });
});
