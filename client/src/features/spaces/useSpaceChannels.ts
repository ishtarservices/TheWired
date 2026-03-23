import { useEffect, useCallback, useRef } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import {
  setChannels,
  addChannelToList,
  removeChannelFromList,
  updateChannelInList,
  setChannelsLoading,
} from "../../store/slices/spacesSlice";
import type { Space, SpaceChannel, SpaceChannelType } from "../../types/space";
import * as channelsApi from "../../lib/api/channels";
import { saveChannels, loadChannels } from "../../lib/db/channelStore";

/** Hardcoded defaults used when backend is unavailable */
function makeDefaultChannels(spaceId: string, mode: Space["mode"]): SpaceChannel[] {
  const types: Array<{ type: SpaceChannelType; label: string }> = [
    { type: "chat", label: "#chat" },
    { type: "notes", label: "#notes" },
    { type: "media", label: "#media" },
    { type: "articles", label: "#articles" },
    { type: "music", label: "#music" },
  ];
  // Read-only spaces don't have chat
  const filtered = mode === "read" ? types.filter((t) => t.type !== "chat") : types;
  return filtered.map((ch, i) => ({
    id: `default-${ch.type}`,
    spaceId,
    type: ch.type,
    label: ch.label,
    position: i,
    isDefault: i === 0,
    adminOnly: false,
    slowModeSeconds: 0,
  }));
}

export function useSpaceChannels(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const channels = useAppSelector(
    (s) => (spaceId ? s.spaces.channels[spaceId] : undefined) ?? [],
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaces.channelsLoading[spaceId] : false) ?? false,
  );
  const spaceMode = useAppSelector(
    (s) => s.spaces.list.find((sp) => sp.id === spaceId)?.mode ?? "read-write",
  );

  // Track the last spaceId we fetched from backend to avoid redundant calls
  // within the same space selection (but allow refetch when switching back)
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;

    let cancelled = false;
    const hasCached = channels.length > 0;
    const needsBackendFetch = lastFetchedRef.current !== spaceId;

    // Show loading only on first load (no cached data)
    if (!hasCached) {
      dispatch(setChannelsLoading({ spaceId, loading: true }));
    }

    (async () => {
      // Serve cached data immediately (from Redux or IndexedDB)
      if (!hasCached) {
        const cached = await loadChannels(spaceId);
        if (cached && cached.length > 0 && !cancelled) {
          dispatch(setChannels({ spaceId, channels: cached }));
        }
      }

      // Always revalidate from backend when entering a space
      if (needsBackendFetch) {
        try {
          const fetched = await channelsApi.fetchChannels(spaceId);
          if (!cancelled) {
            dispatch(setChannels({ spaceId, channels: fetched }));
            saveChannels(spaceId, fetched);
            lastFetchedRef.current = spaceId;
          }
        } catch {
          // Backend unavailable — fall back to defaults if nothing cached
          if (!cancelled && !hasCached) {
            const cached = await loadChannels(spaceId);
            if (!cached || cached.length === 0) {
              dispatch(setChannels({ spaceId, channels: makeDefaultChannels(spaceId, spaceMode) }));
            }
          }
        }
      }

      if (!cancelled) {
        dispatch(setChannelsLoading({ spaceId, loading: false }));
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: channels.length intentionally excluded to avoid infinite loops

  const handleCreateChannel = useCallback(
    async (params: { type: string; label: string; adminOnly?: boolean; slowModeSeconds?: number }) => {
      if (!spaceId) return;
      const channel = await channelsApi.createChannel(spaceId, params);
      dispatch(addChannelToList(channel));
      const updated = [...channels, channel];
      saveChannels(spaceId, updated);
    },
    [spaceId, dispatch, channels],
  );

  const handleDeleteChannel = useCallback(
    async (channelId: string) => {
      if (!spaceId) return;
      await channelsApi.deleteChannel(spaceId, channelId);
      dispatch(removeChannelFromList({ spaceId, channelId }));
      const updated = channels.filter((c) => c.id !== channelId);
      saveChannels(spaceId, updated);
    },
    [spaceId, dispatch, channels],
  );

  const handleUpdateChannel = useCallback(
    async (channelId: string, params: { label?: string; adminOnly?: boolean; slowModeSeconds?: number; isDefault?: boolean }) => {
      if (!spaceId) return;
      const updated = await channelsApi.updateChannel(spaceId, channelId, params);
      // When setting a new home channel, clear isDefault on all others in Redux
      // (backend already does this, but client state needs to match)
      if (params.isDefault) {
        const allUpdated = channels.map((c) =>
          c.id === channelId ? updated : { ...c, isDefault: false },
        );
        dispatch(setChannels({ spaceId, channels: allUpdated }));
        saveChannels(spaceId, allUpdated);
      } else {
        dispatch(updateChannelInList(updated));
        const allUpdated = channels.map((c) => (c.id === channelId ? updated : c));
        saveChannels(spaceId, allUpdated);
      }
    },
    [spaceId, dispatch, channels],
  );

  const handleReorderChannels = useCallback(
    async (orderedIds: string[]) => {
      if (!spaceId) return;
      await channelsApi.reorderChannels(spaceId, orderedIds);
      const reordered = orderedIds
        .map((id, i) => {
          const ch = channels.find((c) => c.id === id);
          return ch ? { ...ch, position: i } : null;
        })
        .filter((c): c is SpaceChannel => c !== null);
      dispatch(setChannels({ spaceId, channels: reordered }));
      saveChannels(spaceId, reordered);
    },
    [spaceId, dispatch, channels],
  );

  return {
    channels,
    isLoading,
    createChannel: handleCreateChannel,
    deleteChannel: handleDeleteChannel,
    updateChannel: handleUpdateChannel,
    reorderChannels: handleReorderChannels,
  };
}
