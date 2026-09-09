import { describe, it, expect } from "vitest";
import type { Scene } from "@/lib/api/discover";
import { FALLBACK_SCENES, matchesScene, sceneBySlug, sceneChips } from "../taxonomy";

const club = sceneBySlug(FALLBACK_SCENES, "club")!;
const altRap = sceneBySlug(FALLBACK_SCENES, "alt-rap")!;

/** A server-shaped scene with a live spaceCount. */
function serverScene(over: Partial<Scene> = {}): Scene {
  return {
    slug: "alt-rap",
    label: "Alt Rap",
    description: null,
    genres: ["hip hop"],
    tags: ["rap"],
    spaceCount: 0,
    position: 10,
    ...over,
  };
}

describe("matchesScene", () => {
  it("matches on genre, case-insensitively", () => {
    expect(matchesScene(club, { genre: "Techno" })).toBe(true);
    expect(matchesScene(club, { genre: "techno" })).toBe(true);
    expect(matchesScene(club, { genre: "  TECHNO  " })).toBe(true);
  });

  it("matches on tags, case-insensitively", () => {
    expect(matchesScene(altRap, { tags: ["HipHop", "misc"] })).toBe(true);
    expect(matchesScene(altRap, { tags: ["misc"] })).toBe(false);
  });

  it("does not match an unrelated subject", () => {
    expect(matchesScene(club, { genre: "Jazz", tags: ["philosophy"] })).toBe(false);
  });

  it("handles absent/null vocabularies without throwing", () => {
    expect(matchesScene(club, {})).toBe(false);
    expect(matchesScene(club, { genre: null, tags: [] })).toBe(false);
  });
});

describe("sceneChips", () => {
  it("offers a scene the SERVER says has spaces, with no local corpus at all", () => {
    // The whole point of moving scenes server-side: spaceCount is authoritative.
    const chips = sceneChips([serverScene({ spaceCount: 2 })]);
    expect(chips).toEqual([{ value: "alt-rap", label: "Alt Rap" }]);
  });

  it("still offers a scene the corpus matches even when spaceCount is 0", () => {
    // Music has no spaceCount, and the offline fallback list is always 0 —
    // corpus matching is what keeps both usable.
    const chips = sceneChips(FALLBACK_SCENES, { genres: ["Techno", "Vaporwave"] });
    expect(chips.map((c) => c.value)).toEqual(["club", "vapor"]);
  });

  it("counts space tags as corpus too", () => {
    const chips = sceneChips(FALLBACK_SCENES, { tags: ["diy", "basement"] });
    expect(chips.map((c) => c.value)).toEqual(["garage-diy"]);
  });

  it("offers nothing when neither the server nor the corpus backs a scene", () => {
    expect(sceneChips(FALLBACK_SCENES, { tags: ["philosophy"] })).toEqual([]);
    expect(sceneChips(FALLBACK_SCENES)).toEqual([]);
    expect(sceneChips([])).toEqual([]);
  });

  it("keeps the server label as written — the desktop speaks Title Case", () => {
    const chips = sceneChips([serverScene({ label: "Garage / DIY", spaceCount: 1 })]);
    expect(chips[0].label).toBe("Garage / DIY");
  });
});

describe("FALLBACK_SCENES", () => {
  it("is shaped like a server scene so a fallback render is indistinguishable", () => {
    for (const scene of FALLBACK_SCENES) {
      expect(typeof scene.slug).toBe("string");
      expect(Array.isArray(scene.genres)).toBe(true);
      expect(Array.isArray(scene.tags)).toBe(true);
      expect(scene.spaceCount).toBe(0); // offline we cannot know
    }
  });
});
