// The scene vocabulary — the browse layer over two vocabularies (space tags,
// music genres) that were never designed to be browsed together.
//
// Scenes live in the backend (`GET /discovery/scenes`, lib/api/discover.ts):
// editable without a release and shared with mobile. The list below is the
// OFFLINE FALLBACK. Discover is the landing surface for anyone with no joined
// spaces, so it has to render browse chips even when that call fails or the
// backend predates the endpoint — a chipless Discover is a dead end.
//
// A scene maps onto BOTH space tags and music genres, so one chip means the
// same thing in the Spaces segment and the Music segment.
//
// Pure module: no i/o, no theme, no React.

import type { Scene } from "@/lib/api/discover";

/** Mirrors the seeded server rows closely enough that a fallback render looks
 *  like the real thing. spaceCount is 0 because offline we cannot know. */
export const FALLBACK_SCENES: readonly Scene[] = [
  {
    slug: "alt-rap",
    label: "Alt Rap",
    description: null,
    genres: ["hip hop", "hip-hop", "rap", "trap", "plugg", "cloud rap", "drain"],
    tags: ["rap", "hiphop", "hip-hop", "altrap", "plugg", "drain"],
    spaceCount: 0,
    position: 10,
  },
  {
    slug: "experimental",
    label: "Experimental",
    description: null,
    genres: ["experimental", "noise", "drone", "ambient", "avant-garde"],
    tags: ["experimental", "noise", "drone", "ambient", "avantgarde"],
    spaceCount: 0,
    position: 20,
  },
  {
    slug: "garage-diy",
    label: "Garage / DIY",
    description: null,
    genres: ["garage", "lo-fi", "lofi", "punk", "shoegaze", "indie rock"],
    tags: ["diy", "garage", "punk", "lofi", "lo-fi", "basement", "demo"],
    spaceCount: 0,
    position: 30,
  },
  {
    slug: "club",
    label: "Club",
    description: null,
    genres: ["techno", "dance", "house", "drum & bass", "electronic"],
    tags: ["techno", "house", "dnb", "drumandbass", "club", "rave", "electronic"],
    spaceCount: 0,
    position: 40,
  },
  {
    slug: "vapor",
    label: "Vapor",
    description: null,
    genres: ["vaporwave", "synthwave", "chillwave"],
    tags: ["vaporwave", "synthwave", "chillwave", "plunderphonics"],
    spaceCount: 0,
    position: 50,
  },
  {
    slug: "soul",
    label: "Soul / Jazz",
    description: null,
    genres: ["r&b", "soul", "jazz", "funk"],
    tags: ["rnb", "r&b", "soul", "jazz", "funk", "neosoul"],
    spaceCount: 0,
    position: 60,
  },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Case-insensitive membership against a scene's vocabularies. */
export function matchesScene(
  scene: Scene,
  subject: { tags?: string[]; genre?: string | null },
): boolean {
  const genre = subject.genre ? normalize(subject.genre) : null;
  if (genre && scene.genres.some((g) => normalize(g) === genre)) return true;
  if (!subject.tags?.length) return false;
  const wanted = new Set(scene.tags.map(normalize));
  return subject.tags.some((t) => wanted.has(normalize(t)));
}

export function sceneBySlug(scenes: readonly Scene[], slug: string): Scene | undefined {
  return scenes.find((s) => s.slug === slug);
}

export interface SceneChip {
  value: string;
  label: string;
}

/**
 * Only offer scenes with something behind them — a chip leading to an empty
 * list reads as a broken app rather than an empty scene.
 *
 * A scene qualifies if the server says it has listed spaces, OR if the corpus
 * the caller actually loaded contains one of its tags/genres. The second half
 * is what makes this work for music (where `spaceCount` says nothing) and for
 * the offline fallback (where it is always 0).
 */
export function sceneChips(
  scenes: readonly Scene[],
  corpus: { tags?: string[]; genres?: string[] } = {},
): SceneChip[] {
  const tags = new Set((corpus.tags ?? []).map(normalize));
  const genres = new Set((corpus.genres ?? []).map(normalize));
  return scenes
    .filter(
      (scene) =>
        scene.spaceCount > 0 ||
        scene.tags.some((t) => tags.has(normalize(t))) ||
        scene.genres.some((g) => genres.has(normalize(g))),
    )
    .map((scene) => ({ value: scene.slug, label: scene.label }));
}
