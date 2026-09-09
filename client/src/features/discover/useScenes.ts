import { useEffect, useState } from "react";
import { discoverScenes, type Scene } from "@/lib/api/discover";
import { FALLBACK_SCENES } from "./taxonomy";

// Scene vocabulary for the browse chips, server-first.
//
// Starts on the bundled fallback rather than on null so the chip row paints
// immediately and never flashes empty — Discover is the landing surface, and a
// momentarily chipless landing reads as a broken app. The server list replaces
// it when it arrives; a failure just leaves the fallback standing.
//
// The returned array is referentially stable per session (module cache), which
// SpacesSegment relies on: `sceneBySlug(scenes, slug).tags` feeds a fetch
// effect's dependency list.

let cached: Scene[] | null = null;
const fallback: Scene[] = [...FALLBACK_SCENES];

export function useScenes(): Scene[] {
  const [scenes, setScenes] = useState<Scene[]>(cached ?? fallback);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    discoverScenes()
      .then((res) => {
        if (cancelled || res.data.length === 0) return;
        cached = res.data;
        setScenes(res.data);
      })
      .catch(() => {
        // Offline or an older backend — the fallback is already rendered.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return scenes;
}

/** Test seam — clears the module-level cache between cases. */
export function resetScenesCache(): void {
  cached = null;
}
