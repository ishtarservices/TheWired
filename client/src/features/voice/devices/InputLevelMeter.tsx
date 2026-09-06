import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { getUserMedia, stopMediaStream, describeMediaError } from "@/lib/webrtc/mediaDevices";
import { createAudioLevelMonitor } from "@/lib/webrtc/audioProcessing";
import { getLocalMicrophoneStream } from "@/lib/webrtc/livekitClient";
import { useMediaPrefs } from "./useMediaPrefs";

/**
 * Live input level for the selected microphone ("test your mic").
 *
 * When connected to a room the meter taps the mic track LiveKit is already
 * publishing (no second capture, no device contention). Otherwise it opens a
 * preview capture with the selected device + processing flags, released on
 * unmount / when `active` goes false.
 */
export function InputLevelMeter({ active }: { active: boolean }) {
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [prefs] = useMediaPrefs();

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let cancelled = false;
    let preview: MediaStream | null = null;
    let stopMonitor: (() => void) | null = null;

    (async () => {
      let stream = getLocalMicrophoneStream();
      if (!stream) {
        stream = await getUserMedia({
          audio: {
            echoCancellation: prefs.echoCancellation,
            noiseSuppression: prefs.noiseSuppression,
            autoGainControl: prefs.autoGainControl,
          },
          audioDeviceId: prefs.audioInput ?? undefined,
        });
        preview = stream;
      }
      if (cancelled) {
        if (preview) stopMediaStream(preview);
        return;
      }
      setError(null);
      stopMonitor = createAudioLevelMonitor(stream, setLevel, 60);
    })().catch((err) => {
      if (!cancelled) setError(describeMediaError(err, "microphone"));
    });

    return () => {
      cancelled = true;
      stopMonitor?.();
      if (preview) stopMediaStream(preview);
      setLevel(0);
    };
  }, [active, prefs.audioInput, prefs.echoCancellation, prefs.noiseSuppression, prefs.autoGainControl]);

  if (error) {
    return <div className="text-xs text-red-400">{error}</div>;
  }

  const segments = 20;
  const lit = Math.round(level * segments);
  return (
    <div className="flex items-center gap-0.5" aria-label="Microphone input level">
      {Array.from({ length: segments }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-3 flex-1 rounded-sm transition-colors duration-75",
            i < lit
              ? i < segments * 0.6
                ? "bg-green-400"
                : i < segments * 0.85
                  ? "bg-amber-400"
                  : "bg-red-400"
              : "bg-faint",
          )}
        />
      ))}
    </div>
  );
}
