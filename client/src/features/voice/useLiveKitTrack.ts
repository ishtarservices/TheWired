import { useEffect, useState } from "react";
import { RoomEvent, type Track } from "livekit-client";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";

/**
 * Resolve a participant's track for a given source, re-resolving whenever
 * tracks are (un)published or (un)subscribed.
 *
 * A one-shot getTrackPublication() at mount loses the race with optimistic
 * Redux flips: the local camera tile renders (hasVideo=true) BEFORE
 * setCameraEnabled() finishes publishing the track, and with static effect
 * deps nothing ever re-attaches — a permanently black self-view.
 */
export function useLiveKitTrack(
  pubkey: string,
  source: Track.Source,
  isLocal?: boolean,
): Track | null {
  const [track, setTrack] = useState<Track | null>(null);

  useEffect(() => {
    const room = getLivekitRoom();
    if (!room) {
      setTrack(null);
      return;
    }

    const resolve = () => {
      const participant = isLocal
        ? room.localParticipant
        : room.remoteParticipants.get(pubkey);
      setTrack(participant?.getTrackPublication(source)?.track ?? null);
    };

    resolve();

    const events = [
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
    ] as const;
    for (const ev of events) room.on(ev, resolve);
    return () => {
      for (const ev of events) room.off(ev, resolve);
    };
  }, [pubkey, source, isLocal]);

  return track;
}
