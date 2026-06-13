import { memo, useRef } from "react";
import { Avatar } from "../../components/ui/Avatar";
import { BlockedMessage } from "../../components/ui/BlockedMessage";
import { useProfile } from "../profile/useProfile";
import { useUserPopover } from "../profile/UserPopoverContext";
import { useIsBlocked } from "../../hooks/useIsBlocked";
import { useUnblock } from "../../hooks/useUnblock";
import { NoteFooter } from "../spaces/notes/NoteFooter";
import { PollCard } from "./PollCard";
import type { NostrEvent } from "../../types/nostr";

/** A kind:1068 poll in a notes feed: note-card chrome (author header +
 *  engagement footer) around the interactive poll. */
export const PollNoteCard = memo(function PollNoteCard({ event }: { event: NostrEvent }) {
  const { profile } = useProfile(event.pubkey);
  const isBlocked = useIsBlocked(event.pubkey);
  const { openUserPopover } = useUserPopover();
  const avatarRef = useRef<HTMLButtonElement>(null);
  const unblock = useUnblock(event.pubkey);

  if (isBlocked) {
    return <BlockedMessage variant="note" onUnblock={unblock}><div /></BlockedMessage>;
  }

  const name =
    profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const timeStr = new Date(event.created_at * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-lg border-primary-glow bg-card p-4 hover-lift transition-all duration-150 hover:glow-primary">
      <div className="mb-2 flex items-center gap-2">
        <button
          ref={avatarRef}
          type="button"
          onClick={() => {
            if (avatarRef.current) openUserPopover(event.pubkey, avatarRef.current);
          }}
          className="cursor-pointer"
        >
          <Avatar src={profile?.picture} alt={name} size="sm" />
        </button>
        <span className="text-sm font-medium text-heading">{name}</span>
        <span className="text-xs text-muted">{timeStr}</span>
      </div>

      <PollCard event={event} variant="feed" />

      <NoteFooter event={event} />
    </div>
  );
});
