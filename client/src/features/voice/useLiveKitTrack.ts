import { useEffect, useState } from "react";
import type { Track } from "livekit-client";
import { getParticipantTrack, onTrackTopologyChanged } from "@/lib/webrtc/livekitClient";
import type { TileSource } from "@/types/calling";

/**
 * Resolve a participant's track for a tile source, re-resolving whenever
 * tracks are (un)published / (un)subscribed / (un)muted.
 *
 * A one-shot lookup at mount loses the race with optimistic Redux flips:
 * the local camera tile renders (hasVideo=true) BEFORE setCameraEnabled()
 * finishes publishing, and with static effect deps nothing ever
 * re-attaches — a permanently black self-view.
 */
export function useLiveKitTrack(
  pubkey: string,
  source: TileSource,
  isLocal?: boolean,
): Track | null {
  const [track, setTrack] = useState<Track | null>(() =>
    getParticipantTrack(pubkey, source, !!isLocal),
  );

  useEffect(() => {
    const resolve = () => setTrack(getParticipantTrack(pubkey, source, !!isLocal));
    resolve();
    return onTrackTopologyChanged(resolve);
  }, [pubkey, source, isLocal]);

  return track;
}
