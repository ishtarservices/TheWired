import { useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../../store/hooks";
import {
  setBans,
  addBan,
  removeBan,
  setMutes,
  addMute,
  removeMute,
} from "../../../store/slices/spaceConfigSlice";
import type { Ban, Mute } from "../../../types/space";
import * as moderationApi from "../../../lib/api/moderation";

export function useModeration(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const bans = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.bans[spaceId] : undefined) ?? [],
  );
  const mutes = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.mutes[spaceId] : undefined) ?? [],
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
    fetchData();
  }, [fetchData]);

  const handleBanMember = useCallback(
    async (pubkey: string, reason?: string, expiresAt?: number) => {
      if (!spaceId) return;
      const ban = await moderationApi.banMember(spaceId, { pubkey, reason, expiresAt });
      dispatch(addBan({ spaceId, ban: ban as Ban }));
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
    },
    [spaceId],
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
