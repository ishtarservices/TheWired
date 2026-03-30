import { useState } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { buildTrackEvent } from "./musicEventBuilder";
import { signAndSaveLocally } from "@/lib/nostr/publish";
import { selectAudioSource } from "./trackParser";
import type { MusicTrack } from "@/types/music";

interface DuplicateTrackModalProps {
  track: MusicTrack;
  onClose: () => void;
}

export function DuplicateTrackModal({ track, onClose }: DuplicateTrackModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [newTitle, setNewTitle] = useState(`Copy of ${track.title}`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDuplicate = async () => {
    if (!pubkey || !newTitle.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const audioUrl = selectAudioSource(track.variants);
      if (!audioUrl) throw new Error("Could not resolve audio URL");

      const slug = newTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const unsigned = buildTrackEvent(pubkey, {
        title: newTitle,
        artist: track.artist,
        slug,
        duration: track.duration,
        genre: track.genre || undefined,
        audioUrl,
        imageUrl: track.imageUrl,
        hashtags: track.hashtags.length > 0 ? track.hashtags : undefined,
        // No albumRef -- starts unattached
        artistPubkeys: track.artistPubkeys.length > 0 ? track.artistPubkeys : undefined,
        featuredArtists: track.featuredArtists.length > 0 ? track.featuredArtists : undefined,
        visibility: "local", // Draft
      });

      await signAndSaveLocally(unsigned);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate track");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-border card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">Duplicate Track</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Title input */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Title *</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
              placeholder="Track title"
              autoFocus
            />
          </div>

          {/* Info text */}
          <p className="text-xs text-muted">
            Creates a local draft with the same audio. You can edit and publish later.
          </p>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleDuplicate}
            disabled={!newTitle.trim() || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting ? "Duplicating..." : "Duplicate"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
