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
