import { useMemo, useState } from "react";
import { Music2, Plus, X } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { Spinner } from "@/components/ui/Spinner";
import { TrackCard } from "@/features/music/TrackCard";
import { AlbumCard } from "@/features/music/AlbumCard";
import { useProfileShowcase } from "./useProfileShowcase";
import { ShowcasePickerModal } from "./ShowcasePickerModal";

interface ProfileShowcaseTabProps {
  pubkey: string;
}

export function ProfileShowcaseTab({ pubkey }: ProfileShowcaseTabProps) {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isMe = pubkey === myPubkey;
  const {
    showcase,
    loading,
    removeItem,
    resolvedTracks,
    resolvedAlbums,
  } = useProfileShowcase(pubkey);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [managing, setManaging] = useState(false);

  // Build queue from all resolved tracks for playback
  const trackIds = useMemo(
    () => resolvedTracks.map((t) => t.addressableId),
    [resolvedTracks],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size="md" />
      </div>
    );
  }

  const isEmpty = showcase.items.length === 0;

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Music2 size={32} className="text-faint" />
        <p className="text-sm text-muted">
          {isMe
            ? "Add songs from your library to share them here"
            : "No library shared yet"}
        </p>
        {isMe && (
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-primary to-primary-soft px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect"
          >
            <Plus size={14} />
            Add Music
          </button>
        )}
        {isMe && (
          <ShowcasePickerModal
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with manage/add controls */}
      {isMe && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">
            {showcase.items.length} item{showcase.items.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setManaging((v) => !v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                managing
                  ? "bg-primary/10 text-primary"
                  : "text-muted hover:text-heading hover:bg-surface-hover"
              }`}
            >
              {managing ? "Done" : "Manage"}
            </button>
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-surface-hover px-3 py-1.5 text-xs font-medium text-heading hover:bg-surface-hover/80 transition-colors"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
        </div>
      )}

      {/* Albums */}
      {resolvedAlbums.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {resolvedAlbums.map((album) => (
            <div key={album.addressableId} className="relative group">
              <AlbumCard album={album} />
              {managing && (
                <button
                  onClick={() => removeItem(album.addressableId)}
                  className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tracks */}
      {resolvedTracks.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {resolvedTracks.map((track, i) => (
            <div key={track.addressableId} className="relative group">
              <TrackCard
                track={track}
                queueTracks={trackIds}
                queueIndex={i}
              />
              {managing && (
                <button
                  onClick={() => removeItem(track.addressableId)}
                  className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Some items may not have resolved yet */}
      {(resolvedTracks.length + resolvedAlbums.length) < showcase.items.length && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted">
          <Music2 size={12} />
          Loading {showcase.items.length - resolvedTracks.length - resolvedAlbums.length} more...
        </div>
      )}

      {isMe && (
        <ShowcasePickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
