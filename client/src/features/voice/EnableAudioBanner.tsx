import { Volume2 } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { getLivekitRoom } from "@/lib/webrtc/livekitClient";

/**
 * Autoplay-policy escape hatch. WebView2 (Windows) and WKWebView (macOS)
 * can block audio playback that wasn't started from a user gesture; LiveKit
 * reports this via AudioPlaybackStatusChanged. Clicking the pill calls
 * room.startAudio() inside a gesture, which retries every attached element.
 */
export function EnableAudioBanner() {
  const blocked = useAppSelector((s) => s.voice.audioPlaybackBlocked);

  if (!blocked) return null;

  return (
    <button
      onClick={() => {
        getLivekitRoom()
          ?.startAudio()
          .catch((err) => console.warn("[voice] startAudio failed:", err));
      }}
      className="flex items-center gap-2 mx-auto my-1 rounded-full bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors"
    >
      <Volume2 size={14} />
      Audio is blocked — click to enable
    </button>
  );
}
