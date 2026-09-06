import { useEffect } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { missedCall } from "@/store/slices/callSlice";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { useCall } from "./useCall";
import { startRinging, stopRinging } from "./callRingtone";
import { Phone, PhoneOff, Video } from "lucide-react";

/**
 * Incoming-call banner (top-right toast). Non-blocking on purpose — the old
 * full-screen modal froze the whole app for up to 60s while it rang.
 */
export function IncomingCallBanner() {
  const dispatch = useAppDispatch();
  const incomingCall = useAppSelector((s) => s.call.incomingCall);
  const inVoiceChannel = useAppSelector((s) => s.voice.connectedRoom !== null);
  const { answer, reject } = useCall();

  const callerPubkey = incomingCall?.callerPubkey ?? "";
  const { profile } = useProfile(callerPubkey);
  const displayName = profile?.name ?? profile?.display_name ?? callerPubkey.slice(0, 12);

  // Start/stop ringing
  useEffect(() => {
    if (incomingCall) startRinging();
    else stopRinging();
    return () => stopRinging();
  }, [incomingCall]);

  // Callee-side ring timeout. The caller's 30s timer sends call_missed, but
  // if the caller crashed/went offline that never arrives — without this the
  // banner rings forever.
  useEffect(() => {
    if (!incomingCall) return;
    const timer = setTimeout(() => dispatch(missedCall()), 60_000);
    return () => clearTimeout(timer);
  }, [incomingCall, dispatch]);

  if (!incomingCall) return null;

  const isVideo = incomingCall.callType === "video";

  return (
    <div
      role="alertdialog"
      aria-label={`Incoming ${isVideo ? "video" : "voice"} call from ${displayName}`}
      className="fixed right-4 top-16 z-50 flex w-80 items-center gap-3 rounded-2xl card-glass p-3 shadow-2xl animate-scale-in"
    >
      <div className="relative shrink-0">
        <Avatar src={profile?.picture} alt={displayName} size="md" />
        <div className="absolute -inset-1 rounded-full border-2 border-green-400/50 animate-ping" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-heading">{displayName}</div>
        <div className="text-xs text-muted">
          Incoming {isVideo ? "video" : "voice"} call
          {inVoiceChannel && " · leaves your voice channel"}
        </div>
      </div>

      <button
        onClick={reject}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow hover:bg-red-600 transition-colors"
        title="Decline"
        aria-label="Decline"
      >
        <PhoneOff size={18} />
      </button>
      <button
        onClick={answer}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-500 text-white shadow hover:bg-green-600 transition-colors"
        title="Accept"
        aria-label="Accept"
      >
        {isVideo ? <Video size={18} /> : <Phone size={18} />}
      </button>
    </div>
  );
}
