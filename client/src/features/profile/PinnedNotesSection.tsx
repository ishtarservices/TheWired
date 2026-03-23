import { Pin } from "lucide-react";
import { ProfileNoteCard } from "./NoteCard";
import { usePinnedNotes } from "./usePinnedNotes";
import { Spinner } from "@/components/ui/Spinner";
import type { ProfileFeedItem } from "./useProfileNotes";

interface PinnedNotesSectionProps {
  pubkey: string;
}

/** Max pinned notes to display */
const MAX_PINNED_DISPLAY = 5;

export function PinnedNotesSection({ pubkey }: PinnedNotesSectionProps) {
  const { pinnedEvents, loading } = usePinnedNotes(pubkey);

  if (loading && pinnedEvents.length === 0) {
    return (
      <div className="flex justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (pinnedEvents.length === 0) return null;

  const displayEvents = pinnedEvents.slice(0, MAX_PINNED_DISPLAY);

  return (
    <div className="mb-4">
      {/* Header */}
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Pin size={12} className="rotate-45" />
        <span>Pinned</span>
      </div>

      {/* Pinned notes */}
      <div className="flex flex-col gap-3">
        {displayEvents.map((event) => {
          const item: ProfileFeedItem = {
            event,
            repostedEventId: null,
            reposterPubkey: null,
          };
          return (
            <div
              key={event.id}
              className="relative rounded-xl border-l-2 border-pulse/40"
            >
              <ProfileNoteCard item={item} />
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div className="mt-4 border-b border-edge" />
    </div>
  );
}
