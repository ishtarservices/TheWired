import { Headphones, Music, X } from "lucide-react";
import { useListenTogether } from "./useListenTogether";
import { useProfile } from "@/features/profile/useProfile";

/**
 * Invite banner shown in voice channel / call UI when a DJ has started
 * a Listen Together session. User can Join or Dismiss.
 */
export function ListenTogetherInvite() {
  const { pendingInvite, dismissed, joinSession, dismissInvite } = useListenTogether();

  const djPubkey = pendingInvite?.djPubkey ?? "";
  const { profile } = useProfile(djPubkey);
  const djName = profile?.name ?? profile?.display_name ?? djPubkey.slice(0, 8);

  if (!pendingInvite || dismissed) return null;

  const trackTitle = pendingInvite.trackMeta?.title;
  const trackArtist = pendingInvite.trackMeta?.artist;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/8 border-b border-primary/15 animate-fade-in">
      {/* Icon */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15">
        <Headphones size={16} className="text-primary" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-heading">
          {djName} started Listen Together
        </p>
        {trackTitle && (
          <p className="flex items-center gap-1 text-[10px] text-soft mt-0.5 truncate">
            <Music size={9} className="shrink-0" />
            {trackTitle}
            {trackArtist && <span className="text-muted"> — {trackArtist}</span>}
          </p>
        )}
      </div>

      {/* Actions */}
      <button
        onClick={joinSession}
        className="shrink-0 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/30 transition-colors"
      >
        Join
      </button>
      <button
        onClick={dismissInvite}
        className="shrink-0 rounded-full p-1 text-muted hover:text-heading hover:bg-card-hover transition-colors"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}
