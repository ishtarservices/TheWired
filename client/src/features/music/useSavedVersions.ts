import { useEffect, useCallback } from "react";
import { useAppSelector } from "@/store/hooks";
import { hasPendingUpdate } from "./savedVersions";
import { syncSavedVersions, acknowledgeUpdate, saveVersion } from "./savedVersionSync";

/**
 * Saved-version state for the music UI. Triggers one (throttled, app-wide)
 * backend sync on mount; the heavy lifting lives in `savedVersionSync`.
 */
export function useSavedVersions() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const savedVersions = useAppSelector((s) => s.music.savedVersions);

  useEffect(() => {
    if (pubkey) void syncSavedVersions();
  }, [pubkey]);

  const fetchUpdates = useCallback(() => syncSavedVersions({ force: true }), []);

  return { savedVersions, acknowledgeUpdate, saveVersion, fetchUpdates };
}

/**
 * Derived "update available" for one saved track / project: a strictly newer
 * version is known on the backend or already in Redux. Never true for the
 * author's own items.
 */
export function useHasPendingUpdate(addressableId: string | null | undefined): boolean {
  return useAppSelector((s) => {
    if (!addressableId) return false;
    const saved = s.music.savedVersions[addressableId];
    if (!saved) return false;
    const current = s.music.albums[addressableId] ?? s.music.tracks[addressableId];
    if (current && current.pubkey === s.identity.pubkey) return false;
    return hasPendingUpdate(saved, current);
  });
}
