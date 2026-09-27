import { useEffect } from "react";
import { ShieldOff, X, MessageSquare } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setCallNotice } from "@/store/slices/callSlice";
import { useProfile } from "@/features/profile/useProfile";
import { sendDM } from "@/features/dm/dmService";

/** Auto-dismiss after this long; the user can close it earlier. */
export const CALL_NOTICE_TTL_MS = 15_000;

/** The DM sent by "Let them know" — a plain kind-14 the old client renders. */
export function updateNudgeText(): string {
  return "Calls in The Wired are now end-to-end encrypted — please update your app so we can talk.";
}

/**
 * Why a call didn't go ahead. Rendered as a toast under the incoming-call
 * position; distinct from the in-call banners because there is no call.
 *
 * - peer_outdated: their client doesn't do encrypted calls (legacy invite
 *   auto-declined, or they joined publishing plaintext). Offers a one-click
 *   DM nudge — user-initiated, nothing is sent automatically.
 * - unsupported_device: this WebView can't run the frame cryptor.
 */
export function CallNotice() {
  const dispatch = useAppDispatch();
  const notice = useAppSelector((s) => s.call.notice);
  const { profile } = useProfile(notice?.pubkey ?? "");
  const name = profile?.name ?? profile?.display_name ?? (notice?.pubkey ?? "").slice(0, 12);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => dispatch(setCallNotice(null)), CALL_NOTICE_TTL_MS);
    return () => clearTimeout(timer);
  }, [notice, dispatch]);

  if (!notice) return null;

  const dismiss = () => dispatch(setCallNotice(null));
  const nudge = () => {
    void sendDM(notice.pubkey, updateNudgeText()).catch((err) =>
      console.warn("[call] update nudge failed:", err),
    );
    dismiss();
  };

  return (
    <div
      role="status"
      className="fixed right-4 top-16 z-50 flex w-80 items-start gap-3 rounded-2xl card-glass p-3 shadow-2xl animate-scale-in"
    >
      <div className="mt-0.5 shrink-0 rounded-full bg-amber-500/15 p-1.5 text-amber-400">
        <ShieldOff size={16} />
      </div>
      <div className="min-w-0 flex-1">
        {notice.kind === "peer_outdated" ? (
          <>
            <div className="text-sm font-semibold text-heading">Encrypted calls only</div>
            <p className="mt-0.5 text-xs text-muted">
              {name}&rsquo;s app doesn&rsquo;t support end-to-end encrypted calls yet. The call was
              not connected.
            </p>
            <button
              onClick={nudge}
              className="mt-2 flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25 transition-colors"
            >
              <MessageSquare size={12} />
              Let them know
            </button>
          </>
        ) : (
          <>
            <div className="text-sm font-semibold text-heading">Calls unavailable on this device</div>
            <p className="mt-0.5 text-xs text-muted">
              Calls are end-to-end encrypted, which this device&rsquo;s WebView doesn&rsquo;t
              support.
            </p>
          </>
        )}
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 rounded-full p-1 text-muted hover:bg-surface-hover hover:text-heading transition-colors"
        title="Dismiss"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
