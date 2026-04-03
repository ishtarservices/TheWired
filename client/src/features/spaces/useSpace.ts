import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { store } from "../../store";
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
  openBgChatSub,
  closeBgChatSub,
  enterFriendsFeed,
  leaveFriendsFeed,
  switchFriendsFeedChannel,
} from "../../lib/nostr/groupSubscriptions";
import {
  addSpaceToStore,
  removeSpaceFromStore,
  updateSpaceInStore,
} from "../../lib/db/spaceStore";
import {
  clearChannelUnread,
  clearSpaceUnread,
  updateLastRead,
  addNotification,
  markChannelNotificationsRead,
  setUnreadDivider,
} from "../../store/slices/notificationSlice";
import { clearFeedMeta } from "../../store/slices/feedSlice";
import { fetchMembers, getSpace, fetchFeedSources } from "../../lib/api/spaces";
import { fetchMyOnboardingState, fetchOnboardingPreview } from "../../lib/api/onboarding";
import { ApiRequestError } from "../../lib/api/client";
import { updateSpaceFeedSources } from "../../store/slices/spacesSlice";
import { setOnboardingPending } from "../../store/slices/spaceConfigSlice";
import { selectActiveSpace, parseChannelIdPart } from "./spaceSelectors";
import { clearSpaceFeed } from "../../store/slices/eventsSlice";
import type { Space, SpaceChannel } from "../../types/space";
import { getLastChannel, setLastChannel, removeLastChannel } from "../../lib/db/lastChannelCache";
import { FRIENDS_FEED_ID, FRIENDS_FEED_CHANNELS } from "../friends/friendsFeedConstants";

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

/** Capture old lastRead timestamp for unread divider, then update lastRead and clear unreads */
function activateChannel(channelId: string, dispatch: ReturnType<typeof useAppDispatch>) {
  const state = store.getState();
  const hasUnreads = (state.notifications.channelUnread[channelId] ?? 0) > 0;

  if (hasUnreads) {
    const oldTimestamp = state.notifications.lastReadTimestamps[channelId] ?? 0;
    dispatch(setUnreadDivider({ channelId, timestamp: oldTimestamp }));
  }

  dispatch(clearChannelUnread(channelId));
  dispatch(markChannelNotificationsRead(channelId));
  dispatch(updateLastRead({ contextId: channelId, timestamp: Math.floor(Date.now() / 1000) }));
}

/**
 * Unified cleanup for all slices when a space is removed/deleted.
 * Ensures no stale data lingers in notifications, feed metadata,
 * events indices, or spaceConfig.
 */
function cleanupSpaceState(spaceId: string, dispatch: ReturnType<typeof useAppDispatch>) {
  leaveClientSpace(spaceId);
  closeBgChatSub(spaceId);
  dispatch(removeSpace(spaceId));
  dispatch(clearSpaceUnread(spaceId));
  dispatch(clearSpaceFeed(spaceId));
  dispatch(clearFeedMeta(`${spaceId}:notes`));
  dispatch(clearFeedMeta(`${spaceId}:media`));
  dispatch(clearFeedMeta(`${spaceId}:articles`));
  dispatch(clearFeedMeta(`${spaceId}:music`));
  removeSpaceFromStore(spaceId);
  removeLastChannel(spaceId);
}

export function useSpace() {
  const dispatch = useAppDispatch();
  const spaces = useAppSelector((s) => s.spaces.list);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const allChannels = useAppSelector((s) => s.spaces.channels);

  const activeSpace = useAppSelector(selectActiveSpace);

  /** Fetch members from backend and merge into Redux + IndexedDB */
  const syncMembers = useCallback(
    async (spaceId: string) => {
      try {
        const res = await fetchMembers(spaceId);
        const backendPubkeys = res.data.map((m) => m.pubkey);
        if (backendPubkeys.length === 0) return;

        const space = spaces.find((s) => s.id === spaceId);
        if (!space) return;

        // Merge: union of local + backend members (local may have members
        // the backend doesn't know about yet, e.g. from NIP-29 metadata)
        const merged = [...new Set([...space.memberPubkeys, ...backendPubkeys])];
        if (merged.length !== space.memberPubkeys.length || !merged.every((pk) => space.memberPubkeys.includes(pk))) {
          const updated: Space = { ...space, memberPubkeys: merged };
          dispatch(updateSpace(updated));
          updateSpaceInStore(updated);
        }
      } catch (err) {
        // Space deleted on backend — clean up locally
        if (err instanceof ApiRequestError && err.status === 404) {
          cleanupSpaceState(spaceId, dispatch);
          dispatch(
            addNotification({
              id: `space-gone-${spaceId}`,
              type: "chat",
              title: "Space removed",
              body: "This space no longer exists and has been removed.",
              timestamp: Math.floor(Date.now() / 1000),
            }),
          );
          return;
        }
        // Backend unavailable — keep local members
      }
    },
    [dispatch, spaces],
  );

  /** Fetch feed sources from backend and merge into Redux + IndexedDB.
   *  Re-subscribes the active channel so events from new sources are fetched. */
  const syncFeedSources = useCallback(
    async (spaceId: string) => {
      try {
        const res = await fetchFeedSources(spaceId);
        const pubkeys = res.data;
        const space = spaces.find((s) => s.id === spaceId);
        if (!space) return;

        // Update if different
        const changed =
          pubkeys.length !== space.feedPubkeys.length ||
          !pubkeys.every((pk) => space.feedPubkeys.includes(pk));
        if (changed) {
          dispatch(updateSpaceFeedSources({ spaceId, pubkeys }));
          const updated: Space = { ...space, feedPubkeys: pubkeys };
          updateSpaceInStore(updated);

          // Re-subscribe the active channel with updated feed sources
          const state = store.getState();
          if (state.spaces.activeSpaceId === spaceId && state.spaces.activeChannelId) {
            const spaceChannels = state.spaces.channels[spaceId];
            const channelIdPart = parseChannelIdPart(state.spaces.activeChannelId);
            const channel = spaceChannels?.find((c) => c.id === channelIdPart);
            if (channel) {
              switchSpaceChannel(updated, channel.type);
            }
          }
        }
      } catch {
        // Backend unavailable — keep local feed sources
      }
    },
    [dispatch, spaces],
  );

  const selectSpace = useCallback(
    (spaceId: string) => {
      // Friends Feed virtual space — subscribe to follow list notes
      if (spaceId === FRIENDS_FEED_ID) {
        if (activeSpaceId && activeSpaceId !== FRIENDS_FEED_ID) {
          leaveClientSpace(activeSpaceId);
        } else if (activeSpaceId === FRIENDS_FEED_ID) {
          leaveFriendsFeed();
        }
        dispatch(setActiveSpace(FRIENDS_FEED_ID));
        // Default to first channel and open subscription
        const defaultChannel = FRIENDS_FEED_CHANNELS[0];
        if (defaultChannel) {
          const channelId = `${FRIENDS_FEED_ID}:${defaultChannel.id}`;
          dispatch(setActiveChannel(channelId));
          enterFriendsFeed(defaultChannel.type);
        }
        return;
      }

      const space = spaces.find((s) => s.id === spaceId);
      if (!space) return;

      // Leave previous space
      if (activeSpaceId === FRIENDS_FEED_ID) {
        leaveFriendsFeed();
      } else if (activeSpaceId) {
        leaveClientSpace(activeSpaceId);
      }

      dispatch(setActiveSpace(spaceId));
      enterClientSpace(space);

      // Pick channel: restore last-visited if it still exists, else default
      const spaceChannels = allChannels[spaceId];
      if (spaceChannels && spaceChannels.length > 0) {
        const lastId = getLastChannel(spaceId);
        const restored = lastId ? spaceChannels.find((c) => c.id === lastId) : undefined;
        const best = restored ?? pickDefaultChannel(spaceChannels, space.mode);
        if (best) {
          const channelId = `${spaceId}:${best.id}`;
          dispatch(setActiveChannel(channelId));
          activateChannel(channelId, dispatch);
          switchSpaceChannel(space, best.type);
          setLastChannel(spaceId, best.id);
        }
      } else {
        // Channels not loaded yet — clear channel; will be set once channels load
        dispatch(setActiveChannel(null));
      }

      // Sync members from backend (non-blocking)
      syncMembers(spaceId);

      // Sync feed sources for feed-mode spaces (non-blocking)
      if (space.mode === "read") {
        syncFeedSources(spaceId);
      }

      // Check onboarding state on space entry (non-blocking)
      fetchMyOnboardingState(spaceId)
        .then((res) => {
          if (!res.data || !res.data.completed) {
            // Not completed — check if space actually has onboarding enabled
            fetchOnboardingPreview(spaceId)
              .then((previewRes) => {
                if (previewRes.data && previewRes.data.requireCompletion && previewRes.data.questions.length > 0) {
                  dispatch(setOnboardingPending({ spaceId, pending: true }));
                }
              })
              .catch(() => {});
          } else {
            dispatch(setOnboardingPending({ spaceId, pending: false }));
          }
        })
        .catch(() => {});

      // Background existence check — if the space was deleted, getSpace returns 404
      getSpace(spaceId).catch((err) => {
        if (err instanceof ApiRequestError && err.status === 404) {
          cleanupSpaceState(spaceId, dispatch);
          dispatch(
            addNotification({
              id: `space-gone-${spaceId}`,
              type: "chat",
              title: "Space removed",
              body: "This space no longer exists and has been removed.",
              timestamp: Math.floor(Date.now() / 1000),
            }),
          );
        }
      });
    },
    [dispatch, spaces, activeSpaceId, allChannels, syncMembers, syncFeedSources],
  );

  const selectChannel = useCallback(
    (channelOrType: string) => {
      // Friends Feed virtual space — switch subscription to new channel type
      if (activeSpaceId === FRIENDS_FEED_ID) {
        const channel = FRIENDS_FEED_CHANNELS.find((c) => c.id === channelOrType);
        const channelType = channel?.type ?? channelOrType;
        const channelId = `${FRIENDS_FEED_ID}:${channelOrType}`;
        dispatch(setActiveChannel(channelId));
        switchFriendsFeedChannel(channelType);
        return;
      }

      if (!activeSpace) return;

      // Try to resolve as channel ID first (from channels array)
      const spaceChannels = allChannels[activeSpace.id];
      const channel = spaceChannels?.find((c) => c.id === channelOrType);

      if (channel) {
        const channelId = `${activeSpace.id}:${channel.id}`;
        dispatch(setActiveChannel(channelId));
        activateChannel(channelId, dispatch);
        switchSpaceChannel(activeSpace, channel.type);
        setLastChannel(activeSpace.id, channel.id);
      } else {
        // Legacy: treat as channel type string
        const channelId = `${activeSpace.id}:${channelOrType}`;
        dispatch(setActiveChannel(channelId));
        activateChannel(channelId, dispatch);
        switchSpaceChannel(activeSpace, channelOrType);
      }
    },
    [dispatch, activeSpace, activeSpaceId, allChannels],
  );

  /** Resolve the active channel's SpaceChannel object */
  const resolveActiveChannel = useCallback((): SpaceChannel | null => {
    if (!activeSpaceId || !activeChannelId) return null;
    // Friends Feed has hardcoded channels
    if (activeSpaceId === FRIENDS_FEED_ID) {
      const channelIdPart = parseChannelIdPart(activeChannelId);
      return FRIENDS_FEED_CHANNELS.find((c) => c.id === channelIdPart) ?? null;
    }
    const spaceChannels = allChannels[activeSpaceId];
    if (!spaceChannels) return null;
    const channelIdPart = parseChannelIdPart(activeChannelId);
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
      openBgChatSub(space);
    },
    [dispatch],
  );

  const deleteSpace = useCallback(
    (spaceId: string) => {
      cleanupSpaceState(spaceId, dispatch);
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

  /** Join a space (add it locally and auto-select it) */
  const joinSpace = useCallback(
    (space: Space) => {
      dispatch(addSpace(space));
      addSpaceToStore(space);
      openBgChatSub(space);

      // Leave previous space
      if (activeSpaceId) {
        leaveClientSpace(activeSpaceId);
      }

      dispatch(setActiveSpace(space.id));
      enterClientSpace(space);

      // Pick default channel once channels load
      const spaceChannels = allChannels[space.id];
      if (spaceChannels && spaceChannels.length > 0) {
        const best = pickDefaultChannel(spaceChannels, space.mode);
        if (best) {
          const channelId = `${space.id}:${best.id}`;
          dispatch(setActiveChannel(channelId));
          activateChannel(channelId, dispatch);
          switchSpaceChannel(space, best.type);
        }
      } else {
        dispatch(setActiveChannel(null));
      }

      // Sync members from backend (non-blocking)
      syncMembers(space.id);

      // Sync feed sources for feed-mode spaces
      if (space.mode === "read") {
        syncFeedSources(space.id);
      }
    },
    [dispatch, activeSpaceId, allChannels, syncMembers, syncFeedSources],
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
    joinSpace,
    deleteSpace,
    addMember,
    removeMember,
    syncMembers,
    syncFeedSources,
  };
}
