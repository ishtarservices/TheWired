import { useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../../store/hooks";
import {
  setBans,
  addBan,
  removeBan,
  setMutes,
  addMute,
  removeMute,
  setMembers,
} from "../../../store/slices/spaceConfigSlice";
import { updateSpaceMembers } from "../../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../../lib/db/spaceStore";
import { saveMembers } from "../../../lib/db/spaceMembersStore";
import { syncSpaceMembers } from "../../../store/thunks/spaceMembers";
import type { AppDispatch, RootState } from "../../../store";
import type { Ban, Mute, Space } from "../../../types/space";
import * as moderationApi from "../../../lib/api/moderation";

const EMPTY_BANS: Ban[] = [];
const EMPTY_MUTES: Mute[] = [];

/**
 * Thunk: atomically remove a member from BOTH state sources + IndexedDB.
 *
 * After kick/ban we want the user to disappear from MemberList AND MembersTab AND
 * MemberContextMenu (which reads spaceConfig.members for role-rank checks) without
 * waiting for a background refetch. This thunk does the synchronous write-through.
 *
 * A background `syncSpaceMembers` is fired-and-forgotten afterward to confirm with
 * the backend; if the optimistic update happened to be wrong (rare race), the
 * authoritative refetch corrects it within seconds.
 *
 * Implemented as a thunk so it consults the *dispatched* store (not the singleton)
 * — important for testability and for any future multi-store scenarios.
 */
function removeMemberLocallyThunk(spaceId: string, pubkey: string) {
  return (dispatch: AppDispatch, getState: () => RootState) => {
    const state = getState();
    const space = state.spaces.list.find((s) => s.id === spaceId);
    const currentMembers = state.spaceConfig.members[spaceId] ?? [];

    const inSpaces = !!space?.memberPubkeys.includes(pubkey);
    const inConfig = currentMembers.some((m) => m.pubkey === pubkey);
    if (!inSpaces && !inConfig) return;

    // 1. spaces.list[*].memberPubkeys
    if (space && inSpaces) {
      const nextPubkeys = space.memberPubkeys.filter((pk) => pk !== pubkey);
      dispatch(updateSpaceMembers({ spaceId, members: nextPubkeys }));
      const updatedSpace: Space = { ...space, memberPubkeys: nextPubkeys };
      updateSpaceInStore(updatedSpace);
    }

    // 2. spaceConfig.members[spaceId]
    if (inConfig) {
      const nextMembers = currentMembers.filter((m) => m.pubkey !== pubkey);
      dispatch(setMembers({ spaceId, members: nextMembers }));
      saveMembers(spaceId, nextMembers).catch(() => {/* best-effort */});
    }

    // 3. Background revalidate. Confirms with backend; corrects if our optimistic
    //    state diverged. Fire-and-forget — UI doesn't block on it.
    void dispatch(syncSpaceMembers(spaceId));
  };
}

export function useModeration(spaceId: string | null, enabled = true) {
  const dispatch = useAppDispatch();
  const bans = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.bans[spaceId] : undefined) ?? EMPTY_BANS,
  );
  const mutes = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.mutes[spaceId] : undefined) ?? EMPTY_MUTES,
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.loading[spaceId] : false) ?? false,
  );

  const fetchData = useCallback(async () => {
    if (!spaceId) return;
    try {
      const [fetchedBans, fetchedMutes] = await Promise.all([
        moderationApi.fetchBans(spaceId),
        moderationApi.fetchMutes(spaceId),
      ]);
      dispatch(setBans({ spaceId, bans: fetchedBans }));
      dispatch(setMutes({ spaceId, mutes: fetchedMutes }));
    } catch {
      // Backend unavailable or no permission
    }
  }, [spaceId, dispatch]);

  useEffect(() => {
    if (!enabled) return;
    fetchData();
  }, [fetchData, enabled]);

  const handleBanMember = useCallback(
    async (pubkey: string, reason?: string, expiresAt?: number) => {
      if (!spaceId) return;
      const ban = await moderationApi.banMember(spaceId, { pubkey, reason, expiresAt });
      dispatch(addBan({ spaceId, ban: ban as Ban }));
      dispatch(removeMemberLocallyThunk(spaceId, pubkey));
    },
    [spaceId, dispatch],
  );

  const handleUnbanMember = useCallback(
    async (pubkey: string) => {
      if (!spaceId) return;
      await moderationApi.unbanMember(spaceId, pubkey);
      dispatch(removeBan({ spaceId, pubkey }));
    },
    [spaceId, dispatch],
  );

  const handleMuteMember = useCallback(
    async (pubkey: string, durationSeconds: number, channelId?: string) => {
      if (!spaceId) return;
      const mute = await moderationApi.muteMember(spaceId, { pubkey, durationSeconds, channelId });
      dispatch(addMute({ spaceId, mute: mute as Mute }));
    },
    [spaceId, dispatch],
  );

  const handleUnmuteMember = useCallback(
    async (muteId: string) => {
      if (!spaceId) return;
      await moderationApi.unmuteMember(spaceId, muteId);
      dispatch(removeMute({ spaceId, muteId }));
    },
    [spaceId, dispatch],
  );

  const handleKickMember = useCallback(
    async (pubkey: string) => {
      if (!spaceId) return;
      await moderationApi.kickMember(spaceId, pubkey);
      dispatch(removeMemberLocallyThunk(spaceId, pubkey));
    },
    [spaceId, dispatch],
  );

  return {
    bans,
    mutes,
    isLoading,
    banMember: handleBanMember,
    unbanMember: handleUnbanMember,
    muteMember: handleMuteMember,
    unmuteMember: handleUnmuteMember,
    kickMember: handleKickMember,
    refresh: fetchData,
  };
}
