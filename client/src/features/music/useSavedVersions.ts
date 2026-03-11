import { useEffect, useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setSavedVersions, markVersionUpdate, setSavedVersion } from "@/store/slices/musicSlice";
import type { SavedAlbumVersion } from "@/types/music";
import { getApiBaseUrl } from "@/lib/api/client";
import { buildNip98Header } from "@/lib/api/nip98";

/**
 * Hook to fetch and manage saved album version state.
 * Checks the backend for albums with pending updates.
 */
export function useSavedVersions() {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const savedVersions = useAppSelector((s) => s.music.savedVersions);

  const fetchUpdates = useCallback(async () => {
    if (!pubkey) return;

    try {
      const url = `${getApiBaseUrl()}/music/saved-updates`;
      const headers: Record<string, string> = {
        Authorization: await buildNip98Header(url, "GET"),
      };
      const res = await fetch(url, { headers });
      if (!res.ok) return;

      const json = await res.json();
      const rows = json?.data as Array<{
        addressableId: string;
        savedEventId: string;
        savedCreatedAt: number;
        hasUpdate: boolean;
      }> | undefined;
      if (!Array.isArray(rows)) return;

      const versions: Record<string, SavedAlbumVersion> = {};
      for (const row of rows) {
        versions[row.addressableId] = {
          addressableId: row.addressableId,
          savedEventId: row.savedEventId,
          savedCreatedAt: row.savedCreatedAt,
          hasUpdate: row.hasUpdate,
        };
      }
      dispatch(setSavedVersions(versions));
    } catch {
      // ignore
    }
  }, [pubkey, dispatch]);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  const acknowledgeUpdate = useCallback(
    async (addressableId: string, eventId: string, createdAt: number) => {
      if (!pubkey) return;

      // Optimistic update
      dispatch(markVersionUpdate({ addressableId, hasUpdate: false }));

      try {
        const url = `${getApiBaseUrl()}/music/acknowledge-update`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: await buildNip98Header(url, "POST"),
        };
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ addressableId, eventId, createdAt }),
        });

        // Update saved version in Redux
        dispatch(
          setSavedVersion({
            addressableId,
            savedEventId: eventId,
            savedCreatedAt: createdAt,
            hasUpdate: false,
          }),
        );
      } catch {
        // Revert optimistic update on error
        dispatch(markVersionUpdate({ addressableId, hasUpdate: true }));
      }
    },
    [pubkey, dispatch],
  );

  const saveVersion = useCallback(
    async (addressableId: string, eventId: string, createdAt: number) => {
      if (!pubkey) return;

      try {
        const url = `${getApiBaseUrl()}/music/save-version`;
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: await buildNip98Header(url, "POST"),
        };
        await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({ addressableId, eventId, createdAt }),
        });

        dispatch(
          setSavedVersion({
            addressableId,
            savedEventId: eventId,
            savedCreatedAt: createdAt,
            hasUpdate: false,
          }),
        );
      } catch {
        // ignore
      }
    },
    [pubkey, dispatch],
  );

  const albumsWithUpdates = Object.values(savedVersions).filter((v) => v.hasUpdate);

  return { savedVersions, albumsWithUpdates, acknowledgeUpdate, saveVersion, fetchUpdates };
}
