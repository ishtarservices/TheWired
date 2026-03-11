import { useState, useCallback, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { addDownloadedTrack, removeDownloadedTrack } from "@/store/slices/musicSlice";
import { cacheAudio, removeCachedAudio, getAllCachedIds } from "@/lib/db/audioCache";
import { selectAudioSource } from "./trackParser";
import type { MusicTrack } from "@/types/music";

/**
 * Hook for downloading tracks for offline playback.
 */
export function useDownload() {
  const dispatch = useAppDispatch();
  const downloadedIds = useAppSelector((s) => s.music.downloadedTrackIds);
  const [downloading, setDownloading] = useState<string | null>(null);

  // Hydrate downloaded IDs from IndexedDB on mount
  useEffect(() => {
    getAllCachedIds()
      .then((ids) => {
        for (const id of ids) {
          dispatch(addDownloadedTrack(id));
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [error, setError] = useState<string | null>(null);

  const downloadTrack = useCallback(
    async (track: MusicTrack) => {
      const url = selectAudioSource(track.variants);
      if (!url || downloading) return;

      setDownloading(track.addressableId);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          setError(`Download failed (${res.status})`);
          return;
        }
        const blob = await res.blob();
        if (blob.size === 0) {
          setError("Downloaded file is empty");
          return;
        }
        const mimeType = track.variants[0]?.mimeType ?? "audio/mpeg";
        await cacheAudio(track.addressableId, blob, mimeType);
        dispatch(addDownloadedTrack(track.addressableId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Download failed");
      } finally {
        setDownloading(null);
      }
    },
    [dispatch, downloading],
  );

  const removeDownload = useCallback(
    async (addressableId: string) => {
      await removeCachedAudio(addressableId);
      dispatch(removeDownloadedTrack(addressableId));
    },
    [dispatch],
  );

  const isDownloaded = useCallback(
    (addressableId: string) => downloadedIds.includes(addressableId),
    [downloadedIds],
  );

  return {
    downloadTrack,
    removeDownload,
    isDownloaded,
    downloading,
    error,
  };
}
