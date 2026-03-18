import { useEffect, useRef, useState, useCallback } from "react";
import { Track } from "livekit-client";
import { useAppSelector } from "@/store/hooks";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { CallControls } from "./CallControls";
import { useCallSignaling } from "./useCallSignaling";
import { playCallEnd } from "./callRingtone";
import { getLocalStream, getRemoteStream } from "./callService";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import { Loader2, Wifi, Maximize2, Minimize2 } from "lucide-react";

/**
 * Active call overlay for 1:1 DM calls.
 *
 * - Audio call: centered avatar with speaking ring + call timer
 * - Video call: full remote video with local PiP in corner
 * - Minimized mode: small floating chip at bottom-right
 * - SFU fallback: uses LiveKit room tracks instead of P2P streams
 */
export function CallController() {
  const activeCall = useAppSelector((s) => s.call.activeCall);
  const [minimized, setMinimized] = useState(false);

  useCallSignaling();

  const partnerPubkey = activeCall?.partnerPubkey ?? "";
  const { profile } = useProfile(partnerPubkey);
  const displayName = profile?.name ?? profile?.display_name ?? partnerPubkey.slice(0, 12);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Attach P2P streams or LiveKit tracks to video elements
  const attachStreams = useCallback(() => {
    if (!activeCall) return;

    if (activeCall.isSfuFallback) {
      // SFU mode: get tracks from LiveKit room
      const room = getLivekitRoom();
      if (!room) return;

      // Local camera
      const localCameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (localCameraPub?.track && localVideoRef.current) {
        localCameraPub.track.attach(localVideoRef.current);
      }

      // Remote camera (first remote participant)
      for (const rp of room.remoteParticipants.values()) {
        const remoteCameraPub = rp.getTrackPublication(Track.Source.Camera);
        if (remoteCameraPub?.track && remoteVideoRef.current) {
          remoteCameraPub.track.attach(remoteVideoRef.current);
          break;
        }
      }
    } else {
      // P2P mode: attach MediaStreams directly
      const localStream = getLocalStream();
      const remoteStream = getRemoteStream();

      if (localVideoRef.current && localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    }
  }, [activeCall?.isSfuFallback, activeCall?.state]);

  // Re-attach when streams change
  useEffect(() => {
    attachStreams();
    // Poll briefly for stream availability during connection
    if (activeCall?.state === "active") {
      const interval = setInterval(attachStreams, 1000);
      const timeout = setTimeout(() => clearInterval(interval), 5000);
      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    }
  }, [attachStreams, activeCall?.state]);

  // Play end sound on unmount
  useEffect(() => {
    return () => {
      if (activeCall) playCallEnd();
    };
  }, []);

  if (!activeCall) return null;

  const isVideo = activeCall.callType === "video";
  const isConnecting = activeCall.state === "connecting" || activeCall.state === "ringing";

  // ─── Minimized chip ─────────────────────────────────────────
  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-40 flex items-center gap-3 rounded-2xl card-glass px-4 py-3 shadow-xl cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setMinimized(false)}
      >
        <div className="relative">
          <Avatar src={profile?.picture} alt={displayName} size="sm" />
          {activeCall.state === "active" && (
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-green-400 border border-surface" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-heading truncate">{displayName}</div>
          <div className="text-[10px] text-muted">
            {isConnecting ? "Connecting..." : <CallTimer startedAt={activeCall.startedAt} />}
          </div>
        </div>
        <Maximize2 size={14} className="text-muted shrink-0" />
      </div>
    );
  }

  // ─── Expanded overlay ───────────────────────────────────────
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col rounded-t-2xl card-glass shadow-2xl sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[420px] sm:rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface/50">
        <div className="flex items-center gap-2">
          {activeCall.isSfuFallback && (
            <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
              Relayed
            </span>
          )}
          <span className="text-xs text-muted">
            {isConnecting ? (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                {activeCall.state === "ringing" ? "Ringing..." : "Connecting..."}
              </span>
            ) : (
              <CallTimer startedAt={activeCall.startedAt} />
            )}
          </span>
        </div>
        <button
          onClick={() => setMinimized(true)}
          className="rounded-full p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
        >
          <Minimize2 size={14} />
        </button>
      </div>

      {/* Video / avatar area */}
      {isVideo ? (
        <div className="relative aspect-video w-full bg-black">
          {/* Remote video (full area) */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="h-full w-full object-cover"
          />

          {/* Remote avatar fallback when no video track */}
          {isConnecting && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
              <Avatar src={profile?.picture} alt={displayName} size="lg" />
              <p className="mt-3 text-sm text-white/70">
                {activeCall.state === "ringing" ? "Ringing..." : "Connecting..."}
              </p>
              <Loader2 size={20} className="mt-2 text-white/50 animate-spin" />
            </div>
          )}

          {/* Local video PiP (bottom-right) */}
          <div className="absolute bottom-3 right-3 w-28 aspect-video rounded-xl overflow-hidden bg-surface/80 shadow-lg ring-1 ring-white/10">
            {activeCall.isVideoEnabled ? (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover scale-x-[-1]"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Avatar src={undefined} alt="You" size="sm" />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Audio-only: large centered avatar */
        <div className="flex flex-col items-center gap-3 py-8 px-4">
          <div className="relative">
            <Avatar src={profile?.picture} alt={displayName} size="lg" />
            {activeCall.state === "active" && (
              <div className="absolute -inset-1.5 rounded-full ring-2 ring-green-400/40 animate-pulse" />
            )}
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold text-heading">{displayName}</div>
            {activeCall.state === "active" ? (
              <div className="flex items-center justify-center gap-1 text-xs text-green-400 mt-1">
                <Wifi size={10} />
                Connected
              </div>
            ) : (
              <div className="text-xs text-muted mt-1">
                {activeCall.state === "ringing" ? "Ringing..." : "Connecting..."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="px-4 py-3 bg-surface/50">
        <CallControls />
      </div>
    </div>
  );
}

/** Live call timer display */
function CallTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return (
    <span>
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
}
