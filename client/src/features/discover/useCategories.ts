import { useCallback, useEffect, useState } from "react";
import { getDiscoverCategories, type SpaceCategory } from "@/lib/api/discover";

// Discovery categories, cached for the session (the useScenes shape).
//
// The list changes about as often as the backend is redeployed, so one fetch
// per launch is plenty: the first visit shows the skeleton while it loads, and
// every later mount of the Spaces segment paints the tile grid from memory
// with no request. `reload` forces a refetch; every mounted subscriber sees
// the new list.

let cached: SpaceCategory[] | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<(rows: SpaceCategory[]) => void>();

function load(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = getDiscoverCategories()
    .then((res) => {
      cached = res.data;
      for (const notify of listeners) notify(res.data);
    })
    .catch(() => {
      // Offline or an older backend — subscribers keep what they have; a
      // first-ever failure resolves to [] so the grid doesn't spin forever.
      if (cached === null) {
        cached = [];
        for (const notify of listeners) notify([]);
      }
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function useCategories(): {
  /** null = never loaded this session (skeleton); [] = loaded, none. */
  categories: SpaceCategory[] | null;
  reload: () => void;
} {
  const [categories, setCategories] = useState<SpaceCategory[] | null>(cached);

  useEffect(() => {
    listeners.add(setCategories);
    if (cached === null) void load();
    return () => {
      listeners.delete(setCategories);
    };
  }, []);

  const reload = useCallback(() => {
    void load();
  }, []);

  return { categories, reload };
}

/** Test seam — clears the module-level cache between cases. */
export function resetCategoriesCache(): void {
  cached = null;
  inFlight = null;
  listeners.clear();
}
