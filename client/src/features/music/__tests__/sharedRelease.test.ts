import { describe, it, expect, beforeEach } from "vitest";
import type { NostrEvent } from "@/types/nostr";
import {
  addressOf,
  isSharedRelease,
  memberPTags,
  movedTargetOf,
  ownersOf,
  parseMembers,
} from "../sharedKey/members";
import { parseTrackEvent } from "../trackParser";
import { parseAlbumEvent } from "../albumParser";
import { buildAlbumEvent, buildProjectProfileEvent, buildTrackEvent } from "../musicEventBuilder";
import { getZapTargets } from "../musicZapTargets";
import { selectMyAlbums, selectMyCollaborations, selectLibraryAlbums } from "../musicSelectors";
import { store, resetAll } from "@/store";
import { login } from "@/store/slices/identitySlice";
import { addAlbum, recordMovedRelease, setHeldProjectKeys } from "@/store/slices/musicSlice";

const ME = "a".repeat(64);
const COOWNER = "b".repeat(64);
const MEMBER = "c".repeat(64);
const PROJECT = "d".repeat(64);
const STRANGER = "e".repeat(64);

function ev(kind: number, pubkey: string, tags: string[][], created_at = 1000): NostrEvent {
  return { id: `${kind}-${pubkey.slice(0, 4)}-${created_at}`, pubkey, created_at, kind, tags, content: "", sig: "" };
}

const sharedAlbumTags = [
  ["d", "basement-tapes"],
  ["title", "basement tapes"],
  ["artist", "ash + ember"],
  ["p", ME, "", "artist"],
  ["p", ME, "", "owner"],
  ["p", COOWNER, "", "owner"],
  ["p", MEMBER, "", "contributor"],
  ["a", `31683:${PROJECT}:track-1`],
];

describe("shared release wire helpers", () => {
  it("parses member roles in tag order, skipping credits and duplicates", () => {
    const members = parseMembers([...sharedAlbumTags, ["p", ME, "", "owner"], ["p", STRANGER, "", "featured"], ["p", STRANGER]]);
    expect(members).toEqual([
      { pubkey: ME, role: "owner" },
      { pubkey: COOWNER, role: "owner" },
      { pubkey: MEMBER, role: "contributor" },
    ]);
    expect(ownersOf(members)).toEqual([ME, COOWNER]);
    expect(memberPTags(members)).toEqual([
      ["p", ME, "", "owner"],
      ["p", COOWNER, "", "owner"],
      ["p", MEMBER, "", "contributor"],
    ]);
  });

  it("a release is shared iff an owner tag names someone other than its author", () => {
    expect(isSharedRelease({ pubkey: PROJECT, owners: [ME] })).toBe(true);
    expect(isSharedRelease({ pubkey: ME, owners: [ME] })).toBe(false);
    expect(isSharedRelease({ pubkey: ME })).toBe(false);
  });

  it("reads a same-kind moved target only", () => {
    const stub = ev(33123, PROJECT, [["d", "x"], ["title", "x"], ["moved", `33123:${"f".repeat(64)}:x`]]);
    expect(movedTargetOf(stub)).toBe(`33123:${"f".repeat(64)}:x`);
    expect(movedTargetOf(ev(31683, PROJECT, [["moved", `33123:${"f".repeat(64)}:x`]]))).toBeNull();
    expect(movedTargetOf(ev(33123, PROJECT, [["moved", "33123:short:x"]]))).toBeNull();
    expect(movedTargetOf(ev(33123, PROJECT, [["d", "x"]]))).toBeNull();
    expect(addressOf(stub)).toBe(`33123:${PROJECT}:x`);
  });
});

describe("parsers and builders keep members", () => {
  it("the album parser exposes owners + members; credits are unchanged", () => {
    const album = parseAlbumEvent(ev(33123, PROJECT, sharedAlbumTags));
    expect(album.owners).toEqual([ME, COOWNER]);
    expect(album.members).toHaveLength(3);
    expect(album.artistPubkeys).toEqual([ME]);
    expect(album.featuredArtists).toEqual([]);
    expect(isSharedRelease(album)).toBe(true);
  });

  it("a track rebuilt from its parsed fields keeps every member tag", () => {
    const original = ev(31683, PROJECT, [
      ["d", "track-1"],
      ["title", "one"],
      ["artist", "ash + ember"],
      ["p", ME, "", "artist"],
      ["p", ME, "", "owner"],
      ["p", COOWNER, "", "owner"],
      ["imeta", "url https://x/a.mp3", "m audio/mpeg"],
      ["visibility", "private"],
    ]);
    const track = parseTrackEvent(original);
    const rebuilt = buildTrackEvent(PROJECT, {
      title: track.title,
      artist: track.artist,
      slug: "track-1",
      audioUrl: "https://x/a.mp3",
      artistPubkeys: track.artistPubkeys,
      members: track.members,
      visibility: track.visibility,
    });
    expect(rebuilt.pubkey).toBe(PROJECT);
    expect(rebuilt.tags).toEqual(expect.arrayContaining([["p", ME, "", "owner"], ["p", COOWNER, "", "owner"], ["visibility", "private"]]));
    expect(rebuilt.content).toBe(""); // relay-gated form, no NIP-44
  });

  it("buildAlbumEvent without members writes none (personal projects unchanged)", () => {
    const unsigned = buildAlbumEvent(ME, { title: "t", artist: "a", slug: "t" });
    expect(unsigned.tags.some((t) => t[0] === "p")).toBe(false);
  });

  it("the project kind 0 names the project, links the coordinate and the starter", () => {
    const k0 = buildProjectProfileEvent(PROJECT, { coord: `33123:${PROJECT}:d`, name: "basement tapes", picture: "https://x/c.jpg", starter: ME });
    expect(k0.kind).toBe(0);
    expect(k0.pubkey).toBe(PROJECT);
    expect(JSON.parse(k0.content)).toEqual({ name: "basement tapes", picture: "https://x/c.jpg" });
    expect(k0.tags).toEqual([["a", `33123:${PROJECT}:d`], ["p", ME, "", "owner"]]);
  });
});

describe("zap targets", () => {
  it("a shared release never targets its project key", () => {
    const album = parseAlbumEvent(ev(33123, PROJECT, sharedAlbumTags));
    expect(getZapTargets(album).map((t) => t.pubkey)).toEqual([ME]);
  });

  it("an uncredited shared release tips its starter, not the key", () => {
    const album = parseAlbumEvent(ev(33123, PROJECT, [["d", "x"], ["title", "x"], ["artist", "band"], ["p", COOWNER, "", "owner"]]));
    expect(getZapTargets(album)).toEqual([{ pubkey: COOWNER, role: "uploader" }]);
  });

  it("a personal release still adds its uploader", () => {
    const album = parseAlbumEvent(ev(33123, ME, [["d", "x"], ["title", "x"], ["artist", "band"]]));
    expect(getZapTargets(album)).toEqual([{ pubkey: ME, role: "uploader" }]);
  });
});

describe("selectors and moved stubs", () => {
  const sharedAlbum = () => parseAlbumEvent(ev(33123, PROJECT, sharedAlbumTags));

  beforeEach(() => {
    store.dispatch(resetAll());
    store.dispatch(login({ pubkey: ME, signerType: "tauri_keystore" }));
  });

  it("a held-key project is mine, not a collaboration", () => {
    store.dispatch(addAlbum(sharedAlbum()));
    store.dispatch(setHeldProjectKeys({ [PROJECT]: `33123:${PROJECT}:basement-tapes` }));
    const state = store.getState();
    expect(selectMyAlbums(ME)(state).map((a) => a.pubkey)).toEqual([PROJECT]);
    expect(selectMyCollaborations(ME)(state)).toEqual([]);
    expect(selectLibraryAlbums(ME)(state)).toHaveLength(1);
  });

  it("owner-tagged without the key on this device: a collaboration", () => {
    store.dispatch(addAlbum(sharedAlbum()));
    const state = store.getState();
    expect(selectMyAlbums(ME)(state)).toEqual([]);
    expect(selectMyCollaborations(ME)(state)).toHaveLength(1);
  });

  it("a recorded stub blocks older copies of the release at its address", () => {
    const album = sharedAlbum();
    store.dispatch(recordMovedRelease({ from: album.addressableId, to: `33123:${"f".repeat(64)}:basement-tapes`, at: 2000 }));
    store.dispatch(addAlbum(album)); // created_at 1000 <= stub
    expect(store.getState().music.albums[album.addressableId]).toBeUndefined();
    store.dispatch(addAlbum({ ...album, createdAt: 3000 })); // republished over the stub
    expect(store.getState().music.albums[album.addressableId]).toBeDefined();
  });
});
