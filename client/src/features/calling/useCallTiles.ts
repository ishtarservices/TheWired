import { useMemo, useRef } from "react";
import { useAppSelector } from "@/store/hooks";
import { buildTiles, updateParticipantOrder } from "@/features/media/buildTiles";
import type { MediaTileModel } from "@/features/media/types";

/**
 * Stage tiles for the active 1:1 call. The call is a LiveKit room, so the
 * remote side comes from `voice.participants` exactly like a channel; the
 * local flags come from `call.activeCall` (the call's own mute/camera
 * state). Order: local camera, partner camera, then screen shares.
 */
export function useCallTiles(): MediaTileModel[] {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const activeCall = useAppSelector((s) => s.call.activeCall);
  const participants = useAppSelector((s) => s.voice.participants);
  const activeSpeakers = useAppSelector((s) => s.voice.activeSpeakers);
  const orderRef = useRef<string[]>([]);

  const isMuted = activeCall?.isMuted ?? false;
  const isVideoEnabled = activeCall?.isVideoEnabled ?? false;
  const isScreenSharing = activeCall?.isScreenSharing ?? false;

  return useMemo(() => {
    if (!activeCall) return [];
    orderRef.current = updateParticipantOrder(orderRef.current, participants);
    return buildTiles({
      myPubkey,
      local: { muted: isMuted, videoEnabled: isVideoEnabled, screenSharing: isScreenSharing },
      participants,
      order: orderRef.current,
      activeSpeakers,
    });
    // activeCall identity is not a dep on purpose — only its media flags matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myPubkey, !!activeCall, isMuted, isVideoEnabled, isScreenSharing, participants, activeSpeakers]);
}
