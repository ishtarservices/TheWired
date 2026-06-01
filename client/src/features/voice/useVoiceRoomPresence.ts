import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setRoomPresence } from "@/store/slices/voiceSlice";
import { fetchVoiceRooms } from "@/lib/api/voice";
import { isBackendBacked } from "../spaces/spaceType";
import type { RoomPresenceInfo } from "@/store/slices/voiceSlice";

const POLL_INTERVAL = 15_000; // 15 seconds

/**
 * Polls the backend for active voice room participants in a space.
 * This allows all space members to see who's in each voice channel
 * without needing to join the channel themselves.
 */
export function useVoiceRoomPresence(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const isLoggedIn = useAppSelector((s) => !!s.identity.pubkey);
  // Voice presence comes from the platform backend; nip29-native (imported /
  // self-hosted-relay) spaces have no backend record, so polling just 403s.
  // Default true when the space is unknown (preserves platform behavior).
  const backendBacked = useAppSelector((s) => {
    const sp = spaceId ? s.spaces.list.find((x) => x.id === spaceId) : undefined;
    return sp ? isBackendBacked(sp) : true;
  });
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!spaceId || !isLoggedIn || !backendBacked) {
      dispatch(setRoomPresence({}));
      return;
    }

    const poll = async () => {
      try {
        const rooms = await fetchVoiceRooms(spaceId);
        const presence: Record<string, RoomPresenceInfo> = {};
        for (const room of rooms) {
          presence[room.channelId] = {
            participantCount: room.participantCount,
            participants: room.participants,
          };
        }
        dispatch(setRoomPresence(presence));
      } catch {
        // Silently ignore — presence is best-effort
      }
    };

    // Poll immediately, then on interval
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      clearInterval(intervalRef.current);
      dispatch(setRoomPresence({}));
    };
  }, [spaceId, isLoggedIn, backendBacked, dispatch]);
}
