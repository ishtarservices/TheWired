import { useState } from "react";
import { Pin } from "lucide-react";
import { ProfileNoteCard } from "./NoteCard";
import { usePinnedNotes } from "./usePinnedNotes";
import { PINNED_PREVIEW } from "./pinList";
import { Spinner } from "@/components/ui/Spinner";
import type { ProfileFeedItem } from "./useProfileNotes";

interface PinnedNotesSectionProps {
  pubkey: string;
}

/** The profile's pinned notes, newest pin first: PINNED_PREVIEW of them, then
 *  "Show all" — every pin stays reachable however many the list holds. */
export function PinnedNotesSection({ pubkey }: PinnedNotesSectionProps) {
  const { pinnedEvents, loading } = usePinnedNotes(pubkey);
  const [expanded, setExpanded] = useState(false);

  if (loading && pinnedEvents.length === 0) {
    return (
      <div className="flex justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  if (pinnedEvents.length === 0) return null;

  const displayEvents = expanded ? pinnedEvents : pinnedEvents.slice(0, PINNED_PREVIEW);
  const foldable = pinnedEvents.length > PINNED_PREVIEW;

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
              className="relative rounded-xl border-l-2 border-primary/40"
            >
              <ProfileNoteCard item={item} />
            </div>
          );
        })}
      </div>

      {foldable && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-muted transition-colors hover:text-heading"
        >
          {expanded ? "Show less" : `Show all ${pinnedEvents.length}`}
        </button>
      )}

      {/* Divider */}
      <div className="mt-4 border-b border-border" />
    </div>
  );
}
