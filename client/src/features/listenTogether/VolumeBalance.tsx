import { Volume2, Mic } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setVolume } from "@/store/slices/musicSlice";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import { useState, useCallback } from "react";

/**
 * Dual slider for independently adjusting music vs. voice volume
 * during a Listen Together session.
 */
export function VolumeBalance() {
  const dispatch = useAppDispatch();
  const musicVolume = useAppSelector((s) => s.music.player.volume);
  const [voiceVolume, setVoiceVolume] = useState(1);

  const handleMusicVolume = useCallback(
    (v: number) => {
      dispatch(setVolume(v));
    },
    [dispatch],
  );

  const handleVoiceVolume = useCallback((v: number) => {
    setVoiceVolume(v);
    // Adjust all remote LiveKit audio track volumes via attached elements
    const room = getLivekitRoom();
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      for (const pub of participant.audioTrackPublications.values()) {
        if (pub.track) {
          const elements = pub.track.attachedElements;
          for (const el of elements) {
            if (el instanceof HTMLAudioElement || el instanceof HTMLVideoElement) {
              el.volume = v;
            }
          }
        }
      }
    }
  }, []);

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-[10px] text-muted uppercase tracking-wider">Volume Balance</p>

      {/* Music volume */}
      <div className="flex items-center gap-2">
        <Volume2 size={14} className="text-primary shrink-0" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={musicVolume}
          onChange={(e) => handleMusicVolume(parseFloat(e.target.value))}
          className="flex-1 h-1 cursor-pointer appearance-none rounded-full bg-surface-hover accent-primary
            [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
        />
        <span className="text-[10px] text-muted w-7 text-right tabular-nums">
          {Math.round(musicVolume * 100)}
        </span>
      </div>

      {/* Voice volume */}
      <div className="flex items-center gap-2">
        <Mic size={14} className="text-green-400 shrink-0" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={voiceVolume}
          onChange={(e) => handleVoiceVolume(parseFloat(e.target.value))}
          className="flex-1 h-1 cursor-pointer appearance-none rounded-full bg-surface-hover accent-green-400
            [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-green-400"
        />
        <span className="text-[10px] text-muted w-7 text-right tabular-nums">
          {Math.round(voiceVolume * 100)}
        </span>
      </div>
    </div>
  );
}
