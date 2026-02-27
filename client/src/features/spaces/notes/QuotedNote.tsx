import { memo } from "react";
import { useAppSelector } from "../../../store/hooks";
import { eventsSelectors } from "../../../store/slices/eventsSlice";
import { useProfile } from "../../profile/useProfile";
import { Avatar } from "../../../components/ui/Avatar";

interface QuotedNoteProps {
  eventId: string;
}

export const QuotedNote = memo(function QuotedNote({ eventId }: QuotedNoteProps) {
  const event = useAppSelector((s) => eventsSelectors.selectById(s.events, eventId));
  const { profile } = useProfile(event?.pubkey ?? null);

  if (!event) {
    return (
      <div className="mt-2 card-glass rounded-xl p-3 text-xs text-muted">
        Quoted note not found
      </div>
    );
  }

  const name = profile?.display_name || profile?.name || event.pubkey.slice(0, 8) + "...";
  const truncated = event.content.length > 280
    ? event.content.slice(0, 280) + "..."
    : event.content;

  return (
    <div className="mt-2 card-glass rounded-xl p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <Avatar src={profile?.picture} alt={name} size="xs" />
        <span className="text-xs font-medium text-heading">{name}</span>
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed text-body">
        {truncated}
      </p>
    </div>
  );
});
