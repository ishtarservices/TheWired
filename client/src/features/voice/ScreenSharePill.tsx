import { Monitor, MonitorOff } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setScreenSharing } from "@/store/slices/voiceSlice";
import { setCallScreenSharing } from "@/store/slices/callSlice";
import { toggleScreenShare } from "./voiceService";
import { setCallScreenShare } from "@/features/calling/callService";

/**
 * Persistent "You're sharing your screen" pill (Meet-style), visible from
 * ANY channel/page while a share is live — the sharer's own stage tile is a
 * placeholder card, so this is the always-reachable stop control.
 */
export function ScreenSharePill() {
  const dispatch = useAppDispatch();
  const voiceSharing = useAppSelector((s) => s.voice.localState.screenSharing);
  const callSharing = useAppSelector((s) => s.call.activeCall?.isScreenSharing ?? false);
  const inVoice = useAppSelector((s) => s.voice.connectedRoom !== null);

  if (!voiceSharing && !callSharing) return null;

  const stop = async () => {
    if (inVoice && voiceSharing) {
      dispatch(setScreenSharing(false));
      try {
        await toggleScreenShare(false);
      } catch {
        dispatch(setScreenSharing(true));
      }
    } else if (callSharing) {
      dispatch(setCallScreenSharing(false));
      try {
        await setCallScreenShare(false);
      } catch {
        dispatch(setCallScreenSharing(true));
      }
    }
  };

  return (
    <div
      role="status"
      className="fixed left-1/2 top-14 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-sm"
    >
      <Monitor size={14} />
      You&rsquo;re sharing your screen
      <button
        onClick={() => void stop()}
        className="ml-1 flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 transition-colors hover:bg-white/30"
      >
        <MonitorOff size={12} />
        Stop
      </button>
    </div>
  );
}
