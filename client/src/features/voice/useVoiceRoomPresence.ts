import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setRoomPresence } from "@/store/slices/voiceSlice";
import { fetchVoiceRooms } from "@/lib/api/voice";
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
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!spaceId || !isLoggedIn) {
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
  }, [spaceId, isLoggedIn, dispatch]);
}
