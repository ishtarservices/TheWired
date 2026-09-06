import { useEffect } from "react";
import { store } from "@/store";
import { useAppDispatch } from "@/store/hooks";
import { toggleMute, toggleDeafen, toggleVideo } from "@/store/slices/voiceSlice";
import { toggleCallMute, toggleCallVideo } from "@/store/slices/callSlice";
import { syncLocalAudioState, toggleCamera } from "@/features/voice/voiceService";
import { setCallMuted, setCallVideoEnabled } from "@/features/calling/callService";
import { isMacOS } from "@/lib/platform";

const MOD = isMacOS ? "⌘⇧" : "Ctrl+Shift+";

/** Human labels for tooltips. */
export const SHORTCUT = {
  mute: `${MOD}M`,
  deafen: `${MOD}D`,
  camera: `${MOD}V`,
};

/**
 * Global voice/call shortcuts: mute (M), deafen (D, channels only), camera
 * (V) with Cmd+Shift on macOS / Ctrl+Shift elsewhere. Active whenever the
 * user is in a voice channel or a 1:1 call. Mirrors the optimistic-flip +
 * revert-on-failure pattern the buttons use.
 */
export function useCallShortcuts(): void {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMacOS ? e.metaKey : e.ctrlKey;
      if (!mod || !e.shiftKey || e.repeat) return;
      const key = e.key.toUpperCase();
      if (key !== "M" && key !== "D" && key !== "V") return;

      const state = store.getState();
      const inVoice = state.voice.connectedRoom !== null;
      const call = state.call.activeCall;
      if (!inVoice && !call) return;
      e.preventDefault();

      if (key === "M") {
        if (inVoice) {
          dispatch(toggleMute());
          syncLocalAudioState().catch(() => dispatch(toggleMute()));
        } else if (call) {
          const next = !call.isMuted;
          dispatch(toggleCallMute());
          setCallMuted(next).catch(() => dispatch(toggleCallMute()));
        }
      } else if (key === "D") {
        if (inVoice) {
          dispatch(toggleDeafen());
          syncLocalAudioState().catch(() => dispatch(toggleDeafen()));
        }
      } else if (key === "V") {
        if (inVoice) {
          dispatch(toggleVideo());
          toggleCamera().catch(() => dispatch(toggleVideo()));
        } else if (call && call.callType === "video") {
          const next = !call.isVideoEnabled;
          dispatch(toggleCallVideo());
          setCallVideoEnabled(next).catch(() => dispatch(toggleCallVideo()));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
}
