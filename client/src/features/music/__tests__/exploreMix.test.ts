import { describe, it, expect } from "vitest";
import type { MusicAlbum, MusicTrack } from "@/types/music";
import { mixExplore } from "../exploreMix";

const album = (id: string, createdAt: number) =>
  ({ addressableId: `33123:pk:${id}`, title: id, createdAt }) as unknown as MusicAlbum;
const track = (id: string, createdAt: number, albumId?: string) =>
  ({
    addressableId: `31683:pk:${id}`,
    title: id,
    createdAt,
    albumRef: albumId ? `33123:pk:${albumId}` : undefined,
  }) as unknown as MusicTrack;

describe("mixExplore", () => {
  it("puts projects and loose tracks on one wall, newest first", () => {
    const out = mixExplore([album("ep", 30), album("lp", 10)], [track("single", 20)]);
    expect(out.map((i) => `${i.kind}:${i.id.split(":")[2]}`)).toEqual([
      "project:ep",
      "track:single",
      "project:lp",
    ]);
  });

  it("leaves out a track whose project is already on the wall", () => {
    const out = mixExplore([album("ep", 30)], [track("ep-1", 31, "ep"), track("ep-2", 29, "ep")]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("project");
  });

  it("keeps a track whose project is not in this page of results", () => {
    const out = mixExplore([album("ep", 30)], [track("other-1", 40, "elsewhere")]);
    expect(out.map((i) => i.kind)).toEqual(["track", "project"]);
  });

  it("is empty when there is nothing to show", () => {
    expect(mixExplore([], [])).toEqual([]);
  });
});

import { collectionWall } from "../exploreMix";

describe("collectionWall", () => {
  const byId = (...as: MusicAlbum[]) => Object.fromEntries(as.map((a) => [a.addressableId, a]));

  it("shows a saved project once, not once per track", () => {
    const ep = album("ep", 30);
    const out = collectionWall([ep], [track("ep-1", 31, "ep"), track("ep-2", 29, "ep")], byId(ep));
    expect(out.map((i) => i.kind)).toEqual(["project"]);
  });

  it("folds two or more saved tracks of an unsaved project into that project", () => {
    const ep = album("ep", 30);
    const out = collectionWall([], [track("ep-1", 31, "ep"), track("ep-2", 29, "ep")], byId(ep));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "project", id: ep.addressableId });
  });

  it("keeps a single saved track of a project as a track", () => {
    const ep = album("ep", 30);
    const out = collectionWall([], [track("ep-1", 31, "ep")], byId(ep));
    expect(out.map((i) => i.kind)).toEqual(["track"]);
  });

  it("keeps tracks whose project the store has never seen", () => {
    const out = collectionWall([], [track("a", 2, "ghost"), track("b", 1, "ghost")], {});
    expect(out.map((i) => i.kind)).toEqual(["track", "track"]);
  });
});

import { byInteraction, type ExploreItem } from "../exploreMix";

describe("byInteraction", () => {
  const project = (id: string, createdAt: number, pubkey = "other"): ExploreItem => {
    const a = { ...album(id, createdAt), pubkey, trackRefs: [`31683:pk:${id}-1`] } as unknown as MusicAlbum;
    return { kind: "project", id: a.addressableId, album: a };
  };
  const single = (id: string, createdAt: number, pubkey = "other"): ExploreItem => {
    const t = { ...track(id, createdAt), pubkey } as unknown as MusicTrack;
    return { kind: "track", id: t.addressableId, track: t };
  };
  const ctx = (over: Partial<Parameters<typeof byInteraction>[1]> = {}) => ({
    playedAt: {},
    savedStamps: {},
    isMine: (pk: string) => pk === "me",
    tracksOf: (a: MusicAlbum) => a.trackRefs,
    ...over,
  });
  const names = (items: ExploreItem[]) => items.map((i) => i.id.split(":")[2]);

  it("puts the most recently played release first, whatever its release date", () => {
    const out = byInteraction(
      [project("new", 900), project("old", 100)],
      ctx({ playedAt: { "31683:pk:old-1": 5000 }, savedStamps: { "33123:pk:new": 2000, "33123:pk:old": 1000 } }),
    );
    expect(names(out)).toEqual(["old", "new"]);
  });

  it("orders saved releases by when they were saved", () => {
    const out = byInteraction(
      [project("a", 1), project("b", 2)],
      ctx({ savedStamps: { "33123:pk:a": 3000, "33123:pk:b": 2000 } }),
    );
    expect(names(out)).toEqual(["a", "b"]);
  });

  it("counts publishing or editing your own release as an interaction", () => {
    const out = byInteraction(
      [project("saved", 1), project("mine", 4000, "me")],
      ctx({ savedStamps: { "33123:pk:saved": 3000 } }),
    );
    expect(names(out)).toEqual(["mine", "saved"]);
  });

  it("ignores a removed (negative) save stamp", () => {
    const out = byInteraction(
      [single("gone", 1), single("kept", 1)],
      ctx({ savedStamps: { "31683:pk:gone": -9000, "31683:pk:kept": 10 } }),
    );
    expect(names(out)).toEqual(["kept", "gone"]);
  });

  it("keeps incoming order for releases with nothing recorded", () => {
    const out = byInteraction([project("x", 1), project("y", 2), project("z", 3)], ctx());
    expect(names(out)).toEqual(["x", "y", "z"]);
  });
});
