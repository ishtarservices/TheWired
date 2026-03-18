import { useEffect, useRef } from "react";
import { Track } from "livekit-client";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import { ParticipantTile } from "./ParticipantTile";
import type { VoiceParticipant as VoiceParticipantType } from "@/types/calling";
import { useProfile } from "@/features/profile/useProfile";
import { useAppSelector } from "@/store/hooks";

interface ScreenShareViewProps {
  screenSharerPubkey: string;
  participants: VoiceParticipantType[];
}

/**
 * Layout for when someone is sharing their screen.
 * Full-width screen share with a sidebar strip of participant tiles.
 */
export function ScreenShareView({ screenSharerPubkey, participants }: ScreenShareViewProps) {
  const { profile } = useProfile(screenSharerPubkey);
  const displayName = profile?.name ?? profile?.display_name ?? screenSharerPubkey.slice(0, 8);
  const screenRef = useRef<HTMLVideoElement>(null);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const localState = useAppSelector((s) => s.voice.localState);

  // Attach screen share track
  useEffect(() => {
    const room = getLivekitRoom();
    if (!room || !screenRef.current) return;

    const isLocalShare = screenSharerPubkey === room.localParticipant.identity;
    const lkParticipant = isLocalShare
      ? room.localParticipant
      : room.remoteParticipants.get(screenSharerPubkey);

    if (!lkParticipant) return;

    const screenPub = lkParticipant.getTrackPublication(Track.Source.ScreenShare);
    const track = screenPub?.track;

    if (track) {
      track.attach(screenRef.current);
    }

    return () => {
      if (track && screenRef.current) {
        track.detach(screenRef.current);
      }
    };
  }, [screenSharerPubkey]);

  // Build sidebar tiles (local + remotes, small)
  const sidebarTiles = [
    ...(myPubkey
      ? [{
          participant: {
            pubkey: myPubkey,
            displayName: "You",
            isSpeaking: false,
            isMuted: localState.muted,
            isDeafened: localState.deafened,
            hasVideo: localState.videoEnabled,
            isScreenSharing: localState.screenSharing,
            connectionQuality: "good" as const,
            handRaised: false,
            audioLevel: 0,
          },
          isLocal: true,
        }]
      : []),
    ...participants.map((p) => ({ participant: p, isLocal: false })),
  ];

  return (
    <div className="flex h-full gap-2">
      {/* Main screen share area */}
      <div className="flex-1 rounded-xl bg-black overflow-hidden relative min-w-0">
        <video
          ref={screenRef}
          autoPlay
          playsInline
          className="h-full w-full object-contain"
        />
        <div className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-2.5 py-1 text-xs text-white backdrop-blur-sm">
          {displayName}&rsquo;s screen
        </div>
      </div>

      {/* Participant sidebar strip */}
      <div className="w-44 shrink-0 flex flex-col gap-1.5 overflow-y-auto">
        {sidebarTiles.map(({ participant, isLocal }) => (
          <ParticipantTile
            key={participant.pubkey}
            participant={participant}
            isLocal={isLocal}
            compact
          />
        ))}
      </div>
    </div>
  );
}
