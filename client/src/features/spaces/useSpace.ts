import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import {
  setActiveSpace,
  setActiveChannel,
  addSpace,
  removeSpace,
  updateSpace,
} from "../../store/slices/spacesSlice";
import {
  enterClientSpace,
  leaveClientSpace,
  switchSpaceChannel,
} from "../../lib/nostr/groupSubscriptions";
import {
  addSpaceToStore,
  removeSpaceFromStore,
  updateSpaceInStore,
} from "../../lib/db/spaceStore";
import type { Space, SpaceChannel } from "../../types/space";

/** Pick the best default channel for a space, respecting position and isDefault flag */
function pickDefaultChannel(
  channels: SpaceChannel[],
  mode: Space["mode"],
): SpaceChannel | undefined {
  // Hide chat for read-only spaces (matches ChannelList filtering)
  const visible =
    mode === "read" ? channels.filter((c) => c.type !== "chat") : channels;

  if (visible.length === 0) return channels[0]; // fallback to any channel

  const sorted = [...visible].sort((a, b) => a.position - b.position);
  return sorted.find((c) => c.isDefault) ?? sorted[0];
}

export function useSpace() {
  const dispatch = useAppDispatch();
  const spaces = useAppSelector((s) => s.spaces.list);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const allChannels = useAppSelector((s) => s.spaces.channels);

  const activeSpace = spaces.find((s) => s.id === activeSpaceId) ?? null;

  const selectSpace = useCallback(
    (spaceId: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) return;

      // Leave previous space
      if (activeSpaceId) {
        leaveClientSpace(activeSpaceId);
      }

      dispatch(setActiveSpace(spaceId));
      enterClientSpace(space);

      // Pick best default channel from loaded channels
      const spaceChannels = allChannels[spaceId];
      if (spaceChannels && spaceChannels.length > 0) {
        const best = pickDefaultChannel(spaceChannels, space.mode);
        if (best) {
          dispatch(setActiveChannel(`${spaceId}:${best.id}`));
          switchSpaceChannel(space, best.type);
        }
      } else {
        // Channels not loaded yet — clear channel; will be set once channels load
        dispatch(setActiveChannel(null));
      }
    },
    [dispatch, spaces, activeSpaceId, allChannels],
  );

  const selectChannel = useCallback(
    (channelOrType: string) => {
      if (!activeSpace) return;

      // Try to resolve as channel ID first (from channels array)
      const spaceChannels = allChannels[activeSpace.id];
      const channel = spaceChannels?.find((c) => c.id === channelOrType);

      if (channel) {
        const channelId = `${activeSpace.id}:${channel.id}`;
        dispatch(setActiveChannel(channelId));
        switchSpaceChannel(activeSpace, channel.type);
      } else {
        // Legacy: treat as channel type string
        const channelId = `${activeSpace.id}:${channelOrType}`;
        dispatch(setActiveChannel(channelId));
        switchSpaceChannel(activeSpace, channelOrType);
      }
    },
    [dispatch, activeSpace, allChannels],
  );

  /** Resolve the active channel's SpaceChannel object */
  const resolveActiveChannel = useCallback((): SpaceChannel | null => {
    if (!activeSpaceId || !activeChannelId) return null;
    const spaceChannels = allChannels[activeSpaceId];
    if (!spaceChannels) return null;
    const channelIdPart = activeChannelId.split(":").slice(1).join(":");
    return spaceChannels.find((c) => c.id === channelIdPart) ?? null;
  }, [activeSpaceId, activeChannelId, allChannels]);

  /** Get the channel type for the active channel (with legacy fallback) */
  const getActiveChannelType = useCallback((): string => {
    const channel = resolveActiveChannel();
    if (channel) return channel.type;
    // Legacy fallback: last segment is the type
    return activeChannelId?.split(":").pop() ?? "";
  }, [resolveActiveChannel, activeChannelId]);

  const createSpace = useCallback(
    (space: Space) => {
      dispatch(addSpace(space));
      addSpaceToStore(space);
    },
    [dispatch],
  );

  const deleteSpace = useCallback(
    (spaceId: string) => {
      leaveClientSpace(spaceId);
      dispatch(removeSpace(spaceId));
      removeSpaceFromStore(spaceId);
    },
    [dispatch],
  );

  const addMember = useCallback(
    (spaceId: string, pubkey: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space || space.memberPubkeys.includes(pubkey)) return;

      const updated: Space = {
        ...space,
        memberPubkeys: [...space.memberPubkeys, pubkey],
      };
      dispatch(updateSpace(updated));
      updateSpaceInStore(updated);

      // Re-subscribe if this is the active space to pick up new member's content
      if (activeSpaceId === spaceId && activeChannelId) {
        const channelType = getActiveChannelType();
        switchSpaceChannel(updated, channelType);
      }
    },
    [dispatch, spaces, activeSpaceId, activeChannelId, getActiveChannelType],
  );

  const removeMember = useCallback(
    (spaceId: string, pubkey: string) => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) return;

      const updated: Space = {
        ...space,
        memberPubkeys: space.memberPubkeys.filter((pk) => pk !== pubkey),
      };
      dispatch(updateSpace(updated));
      updateSpaceInStore(updated);

      // Re-subscribe if this is the active space
      if (activeSpaceId === spaceId && activeChannelId) {
        const channelType = getActiveChannelType();
        switchSpaceChannel(updated, channelType);
      }
    },
    [dispatch, spaces, activeSpaceId, activeChannelId, getActiveChannelType],
  );

  return {
    spaces,
    activeSpace,
    activeSpaceId,
    activeChannelId,
    selectSpace,
    selectChannel,
    resolveActiveChannel,
    getActiveChannelType,
    createSpace,
    deleteSpace,
    addMember,
    removeMember,
  };
}
