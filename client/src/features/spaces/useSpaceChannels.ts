import { useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import {
  setChannels,
  addChannelToList,
  removeChannelFromList,
  updateChannelInList,
  setChannelsLoading,
} from "../../store/slices/spacesSlice";
import type { SpaceChannel, SpaceChannelType } from "../../types/space";
import * as channelsApi from "../../lib/api/channels";
import { saveChannels, loadChannels } from "../../lib/db/channelStore";

/** Hardcoded defaults used when backend is unavailable */
function makeDefaultChannels(spaceId: string): SpaceChannel[] {
  const types: Array<{ type: SpaceChannelType; label: string }> = [
    { type: "chat", label: "#chat" },
    { type: "notes", label: "#notes" },
    { type: "media", label: "#media" },
    { type: "articles", label: "#articles" },
    { type: "music", label: "#music" },
  ];
  return types.map((ch, i) => ({
    id: `default-${ch.type}`,
    spaceId,
    type: ch.type,
    label: ch.label,
    position: i,
    isDefault: true,
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

  useEffect(() => {
    if (!spaceId) return;
    // Already loaded
    if (channels.length > 0) return;

    let cancelled = false;
    dispatch(setChannelsLoading({ spaceId, loading: true }));

    (async () => {
      // Try IndexedDB cache first
      const cached = await loadChannels(spaceId);
      if (cached && cached.length > 0 && !cancelled) {
        dispatch(setChannels({ spaceId, channels: cached }));
      }

      // Then try backend
      try {
        const fetched = await channelsApi.fetchChannels(spaceId);
        if (!cancelled) {
          dispatch(setChannels({ spaceId, channels: fetched }));
          saveChannels(spaceId, fetched);
        }
      } catch {
        // Backend unavailable — fall back to defaults if nothing cached
        if (!cancelled && (!cached || cached.length === 0)) {
          dispatch(setChannels({ spaceId, channels: makeDefaultChannels(spaceId) }));
        }
      } finally {
        if (!cancelled) {
          dispatch(setChannelsLoading({ spaceId, loading: false }));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch, channels.length]);

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
    async (channelId: string, params: { label?: string; adminOnly?: boolean; slowModeSeconds?: number }) => {
      if (!spaceId) return;
      const updated = await channelsApi.updateChannel(spaceId, channelId, params);
      dispatch(updateChannelInList(updated));
      const allUpdated = channels.map((c) => (c.id === channelId ? updated : c));
      saveChannels(spaceId, allUpdated);
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
