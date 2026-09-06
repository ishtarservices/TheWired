import { AlertTriangle, RefreshCw, Volume2, WifiOff, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMediaError } from "@/store/slices/voiceSlice";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";
import { retryMicrophone } from "./voiceService";

/**
 * Status banners for a connected voice room, stacked under the header:
 *
 * - autoplay blocked → "Enable audio" (WebView2 / WKWebView need a gesture)
 * - transport reconnecting → LiveKit is re-establishing the connection
 * - media error → mic/camera could not be acquired (denied, busy, missing)
 */
export function VoiceBanners() {
  const dispatch = useAppDispatch();
  const audioBlocked = useAppSelector((s) => s.voice.audioPlaybackBlocked);
  const reconnecting = useAppSelector((s) => s.voice.connectionState === "reconnecting");
  const mediaError = useAppSelector((s) => s.voice.mediaError);

  if (!audioBlocked && !reconnecting && !mediaError) return null;

  return (
    <div className="flex flex-col items-center gap-1 px-4 py-1">
      {audioBlocked && (
        <button
          onClick={() => {
            getLivekitRoom()
              ?.startAudio()
              .catch((err) => console.warn("[voice] startAudio failed:", err));
          }}
          className="flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors"
        >
          <Volume2 size={14} />
          Audio is blocked — click to enable
        </button>
      )}

      {reconnecting && (
        <div className="flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-400">
          <WifiOff size={14} className="animate-pulse" />
          Reconnecting…
        </div>
      )}

      {mediaError && (
        <div className="flex max-w-full items-center gap-2 rounded-xl bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          <AlertTriangle size={14} className="shrink-0" />
          <span className="min-w-0 truncate" title={mediaError}>
            {mediaError}
          </span>
          <button
            onClick={() => void retryMicrophone()}
            className="flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 font-medium hover:bg-red-500/25 transition-colors"
            title="Retry microphone"
          >
            <RefreshCw size={12} />
            Retry mic
          </button>
          <button
            onClick={() => dispatch(setMediaError(null))}
            className="shrink-0 rounded-full p-0.5 hover:bg-red-500/20 transition-colors"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
