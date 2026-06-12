import { useEffect } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { missedCall } from "@/store/slices/callSlice";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";
import { useCall } from "./useCall";
import { startRinging, stopRinging } from "./callRingtone";
import { Phone, PhoneOff, Video } from "lucide-react";

/**
 * Modal shown when there's an incoming call.
 * Displays caller info with accept/decline buttons.
 */
export function IncomingCallModal() {
  const dispatch = useAppDispatch();
  const incomingCall = useAppSelector((s) => s.call.incomingCall);
  const { answer, reject } = useCall();

  const callerPubkey = incomingCall?.callerPubkey ?? "";
  const { profile } = useProfile(callerPubkey);
  const displayName = profile?.name ?? profile?.display_name ?? callerPubkey.slice(0, 12);

  // Start/stop ringing
  useEffect(() => {
    if (incomingCall) {
      startRinging();
    } else {
      stopRinging();
    }
    return () => stopRinging();
  }, [incomingCall]);

  // Callee-side ring timeout. The caller's 30s timer sends call_missed, but
  // if the caller crashed/went offline that never arrives — without this the
  // modal rings forever.
  useEffect(() => {
    if (!incomingCall) return;
    const timer = setTimeout(() => dispatch(missedCall()), 60_000);
    return () => clearTimeout(timer);
  }, [incomingCall, dispatch]);

  if (!incomingCall) return null;

  const isVideo = incomingCall.callType === "video";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-2xl card-glass p-8 shadow-2xl text-center animate-scale-in">
        {/* Caller avatar with pulsing ring */}
        <div className="relative mx-auto mb-4 h-24 w-24">
          <Avatar src={profile?.picture} alt={displayName} size="lg" />
          <div className="absolute -inset-2 rounded-full border-2 border-green-400/50 animate-ping" />
          <div className="absolute -inset-1 rounded-full border border-green-400/30" />
        </div>

        <h3 className="text-lg font-bold text-heading">{displayName}</h3>
        <p className="mt-1 text-sm text-muted">
          Incoming {isVideo ? "video" : "voice"} call...
        </p>

        {/* Accept / Decline buttons */}
        <div className="mt-8 flex items-center justify-center gap-6">
          <button
            onClick={reject}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600 transition-colors"
            title="Decline"
          >
            <PhoneOff size={24} />
          </button>

          <button
            onClick={answer}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg hover:bg-green-600 transition-colors"
            title="Accept"
          >
            {isVideo ? <Video size={24} /> : <Phone size={24} />}
          </button>
        </div>
      </div>
    </div>
  );
}
