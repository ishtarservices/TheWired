import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MusicAlbum, MusicTrack } from "@/types/music";
import type { Space } from "@/types/space";

vi.mock("@/lib/db/eventStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/eventStore")>()),
  deleteAddressableEvent: vi.fn().mockResolvedValue(1),
}));

vi.mock("@/lib/nostr/forgetSeen", () => ({
  registerForgetSeen: vi.fn(),
  forgetSeenEvents: vi.fn(),
}));

import { deleteAddressableEvent } from "@/lib/db/eventStore";
import { forgetSeenEvents } from "@/lib/nostr/forgetSeen";
import { store, resetAll } from "@/store";
import { addAlbums, addTracks } from "@/store/slices/musicSlice";
import { setSpaces } from "@/store/slices/spacesSlice";
import { login } from "@/store/slices/identitySlice";
import { purgeSpaceOnlyMusic, spaceShelf } from "../spaceMusic";

const ME = "a".repeat(64);
const base = {
  artist: "x",
  artistPubkeys: [],
  featuredArtists: [],
  collaborators: [],
  hashtags: [],
};
const album = (id: string, over: Partial<MusicAlbum> = {}) =>
  ({
    ...base,
    addressableId: `33123:author:${id}`,
    pubkey: "author",
    title: id,
    visibility: "space",
    spaceIds: ["neon"],
    trackRefs: [],
    createdAt: 10,
    ...over,
  }) as unknown as MusicAlbum;
const track = (id: string, over: Partial<MusicTrack> = {}) =>
  ({
    ...base,
    addressableId: `31683:author:${id}`,
    pubkey: "author",
    title: id,
    visibility: "space",
    spaceIds: ["neon"],
    createdAt: 10,
    ...over,
  }) as unknown as MusicTrack;
const byId = <T extends { addressableId: string }>(...items: T[]) =>
  Object.fromEntries(items.map((i) => [i.addressableId, i])) as Record<string, T>;
const names = (items: { id: string }[]) => items.map((i) => i.id.split(":")[2]);
const opts = (over: Partial<Parameters<typeof spaceShelf>[2]> = {}) => ({
  joined: new Set(["neon"]),
  isMine: (pk: string) => pk === ME,
  ...over,
});

describe("spaceShelf", () => {
  it("shows space-only releases from joined spaces, newest first", () => {
    const out = spaceShelf(
      byId(album("old", { createdAt: 1 }), album("new", { createdAt: 9 })),
      byId(track("single", { createdAt: 5 })),
      opts(),
    );
    expect(names(out)).toEqual(["new", "single", "old"]);
  });

  it("never shows a release from a space this account is not in", () => {
    // Cached by another account on the device, or from a space since left.
    const out = spaceShelf(byId(album("theirs", { spaceIds: ["elsewhere"] })), {}, opts());
    expect(out).toEqual([]);
  });

  it("leaves public and private releases to the other shelves", () => {
    const out = spaceShelf(
      byId(album("pub", { visibility: "public", spaceIds: [] }), album("priv", { visibility: "private", spaceIds: [] })),
      {},
      opts(),
    );
    expect(out).toEqual([]);
  });

  it("leaves out the viewer's own releases, muted authors and what is already on the page", () => {
    const out = spaceShelf(
      byId(
        album("mine", { pubkey: ME, addressableId: `33123:${ME}:mine` }),
        album("muted", { pubkey: "troll", addressableId: "33123:troll:muted" }),
        album("saved"),
        album("fresh"),
      ),
      {},
      opts({ muted: new Set(["troll"]), exclude: new Set(["33123:author:saved"]) }),
    );
    expect(names(out)).toEqual(["fresh"]);
  });

  it("shows a project once, not its tracks as well", () => {
    const ep = album("ep");
    const out = spaceShelf(byId(ep), byId(track("ep-1", { albumRef: ep.addressableId })), opts());
    expect(out.map((i) => i.kind)).toEqual(["project"]);
  });

  it("keeps a note's attached audio off the shelf", () => {
    const out = spaceShelf({}, byId(track("note-audio", { inCatalog: false })), opts());
    expect(out).toEqual([]);
  });

  it("caps each space so a busy one cannot fill the row", () => {
    const busy = Array.from({ length: 9 }, (_, i) => album(`busy${i}`, { createdAt: 100 - i }));
    const quiet = album("quiet", { spaceIds: ["calm"], createdAt: 1 });
    const out = spaceShelf(byId(...busy, quiet), {}, opts({ joined: new Set(["neon", "calm"]) }));
    expect(names(out)).toEqual(["busy0", "busy1", "busy2", "busy3", "quiet"]);
  });
});

describe("purgeSpaceOnlyMusic", () => {
  const del = vi.mocked(deleteAddressableEvent);

  beforeEach(() => {
    store.dispatch(resetAll());
    del.mockClear();
    store.dispatch(login({ pubkey: ME, signerType: "nip07" }));
    store.dispatch(setSpaces([{ id: "neon" }, { id: "calm" }] as unknown as Space[]));
  });

  it("removes the left space's releases from the store and the local cache", () => {
    store.dispatch(addAlbums([album("ep")]));
    store.dispatch(addTracks([track("single")]));

    purgeSpaceOnlyMusic("neon", store.dispatch);

    const music = store.getState().music;
    expect(music.albums["33123:author:ep"]).toBeUndefined();
    expect(music.tracks["31683:author:single"]).toBeUndefined();
    expect(del).toHaveBeenCalledWith(33123, "author", "ep");
    expect(del).toHaveBeenCalledWith(31683, "author", "single");
  });

  it("lets the same events be fetched again after a rejoin", () => {
    store.dispatch(addAlbums([album("ep", { eventId: "evt-ep" })]));
    store.dispatch(addTracks([track("single", { eventId: "evt-single" })]));
    purgeSpaceOnlyMusic("neon", store.dispatch);
    expect(vi.mocked(forgetSeenEvents)).toHaveBeenCalledWith(
      expect.arrayContaining(["evt-ep", "evt-single"]),
    );
  });

  it("keeps a release shared into another space the viewer is still in", () => {
    store.dispatch(addAlbums([album("both", { spaceIds: ["neon", "calm"] })]));
    purgeSpaceOnlyMusic("neon", store.dispatch);
    expect(store.getState().music.albums["33123:author:both"]).toBeDefined();
    expect(del).not.toHaveBeenCalled();
  });

  it("keeps the viewer's own releases, public music and other spaces' music", () => {
    store.dispatch(
      addAlbums([
        album("mine", { pubkey: ME, addressableId: `33123:${ME}:mine` }),
        album("pub", { visibility: "public", spaceIds: [] }),
        album("other", { spaceIds: ["calm"] }),
      ]),
    );
    purgeSpaceOnlyMusic("neon", store.dispatch);
    expect(Object.keys(store.getState().music.albums).sort()).toEqual(
      [`33123:${ME}:mine`, "33123:author:other", "33123:author:pub"].sort(),
    );
    expect(del).not.toHaveBeenCalled();
  });
});
