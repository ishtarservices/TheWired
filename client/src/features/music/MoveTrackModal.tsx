import { useState, useMemo } from "react";
import { X, ChevronLeft } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { buildTrackEvent, buildAlbumEvent } from "./musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { selectAudioSource } from "./trackParser";
import type { MusicTrack } from "@/types/music";

interface MoveTrackModalProps {
  track: MusicTrack;
  onClose: () => void;
  onBack?: () => void;
}

export function MoveTrackModal({ track, onClose, onBack }: MoveTrackModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const albums = useAppSelector((s) => s.music.albums);

  // Own albums + albums where user is a featured collaborator
  const availableAlbums = useMemo(() => {
    if (!pubkey) return [];
    return Object.values(albums).filter(
      (a) => a.pubkey === pubkey || a.featuredArtists.includes(pubkey),
    );
  }, [albums, pubkey]);

  const [targetAlbumId, setTargetAlbumId] = useState<string>("");
  const [revisionSummary, setRevisionSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentAlbum = track.albumRef ? albums[track.albumRef] : null;
  const currentAlbumTitle = currentAlbum?.title ?? null;

  // Prevent no-op moves
  const isSameAlbum =
    (!targetAlbumId && !track.albumRef) ||
    targetAlbumId === track.albumRef;

  const handleMove = async () => {
    if (!pubkey) return;
    setSubmitting(true);
    setError(null);

    try {
      const audioUrl = selectAudioSource(track.variants);
      if (!audioUrl) throw new Error("Could not resolve audio URL");

      const existingDTag = track.addressableId.split(":").slice(2).join(":");

      // 1. Republish track with new album ref
      const trackUnsigned = buildTrackEvent(pubkey, {
        title: track.title,
        artist: track.artist,
        slug: existingDTag,
        duration: track.duration,
        genre: track.genre || undefined,
        audioUrl,
        imageUrl: track.imageUrl,
        hashtags: track.hashtags.length > 0 ? track.hashtags : undefined,
        albumRef: targetAlbumId || undefined,
        artistPubkeys: track.artistPubkeys.length > 0 ? track.artistPubkeys : undefined,
        featuredArtists: track.featuredArtists.length > 0 ? track.featuredArtists : undefined,
        visibility: track.visibility,
        revisionSummary: revisionSummary || undefined,
      });
      await signAndPublish(trackUnsigned);

      // 2. Remove from source album (if it had one)
      if (track.albumRef) {
        const sourceAlbum = albums[track.albumRef];
        if (sourceAlbum && sourceAlbum.pubkey === pubkey) {
          const sourceSlug = sourceAlbum.addressableId.split(":").slice(2).join(":");
          const newTrackRefs = sourceAlbum.trackRefs.filter((r) => r !== track.addressableId);
          const sourceUnsigned = buildAlbumEvent(pubkey, {
            title: sourceAlbum.title,
            artist: sourceAlbum.artist,
            slug: sourceSlug,
            genre: sourceAlbum.genre || undefined,
            imageUrl: sourceAlbum.imageUrl,
            trackRefs: newTrackRefs.length > 0 ? newTrackRefs : undefined,
            featuredArtists: sourceAlbum.featuredArtists.length > 0 ? sourceAlbum.featuredArtists : undefined,
            artistPubkeys: sourceAlbum.artistPubkeys.length > 0 ? sourceAlbum.artistPubkeys : undefined,
            hashtags: sourceAlbum.hashtags.length > 0 ? sourceAlbum.hashtags : undefined,
            projectType: sourceAlbum.projectType,
            visibility: sourceAlbum.visibility,
            sharingDisabled: sourceAlbum.sharingDisabled,
          });
          await signAndPublish(sourceUnsigned);
        }
      }

      // 3. Add to target album (if selected)
      if (targetAlbumId) {
        const targetAlbum = albums[targetAlbumId];
        if (targetAlbum) {
          const targetSlug = targetAlbum.addressableId.split(":").slice(2).join(":");
          const newTrackRefs = [...targetAlbum.trackRefs, track.addressableId];
          const targetUnsigned = buildAlbumEvent(targetAlbum.pubkey, {
            title: targetAlbum.title,
            artist: targetAlbum.artist,
            slug: targetSlug,
            genre: targetAlbum.genre || undefined,
            imageUrl: targetAlbum.imageUrl,
            trackRefs: newTrackRefs,
            featuredArtists: targetAlbum.featuredArtists.length > 0 ? targetAlbum.featuredArtists : undefined,
            artistPubkeys: targetAlbum.artistPubkeys.length > 0 ? targetAlbum.artistPubkeys : undefined,
            hashtags: targetAlbum.hashtags.length > 0 ? targetAlbum.hashtags : undefined,
            projectType: targetAlbum.projectType,
            visibility: targetAlbum.visibility,
            sharingDisabled: targetAlbum.sharingDisabled,
          });
          await signAndPublish(targetUnsigned);
        }
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move track");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-border card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="text-soft hover:text-heading">
                <ChevronLeft size={18} />
              </button>
            )}
            <h2 className="text-lg font-semibold text-heading">Move Track</h2>
          </div>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Track being moved */}
          <div className="rounded-xl border border-border bg-surface px-3 py-2">
            <p className="text-sm font-medium text-heading">{track.title}</p>
            <p className="text-xs text-muted">{track.artist}</p>
          </div>

          {/* Current location */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Current location
            </label>
            <p className="text-sm text-heading">
              {currentAlbumTitle
                ? `Currently in: ${currentAlbumTitle}`
                : "Not in any project"}
            </p>
          </div>

          {/* Target album dropdown */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Move to
            </label>
            <select
              value={targetAlbumId}
              onChange={(e) => setTargetAlbumId(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
            >
              <option value="">None (single)</option>
              {availableAlbums.map((a) => (
                <option key={a.addressableId} value={a.addressableId}>
                  {a.title}
                  {a.pubkey !== pubkey ? " (collaboration)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Revision summary */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              What changed? <span className="text-muted">(optional)</span>
            </label>
            <input
              type="text"
              value={revisionSummary}
              onChange={(e) => setRevisionSummary(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
              placeholder="e.g. Moved to final album"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleMove}
            disabled={isSameAlbum || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting ? "Moving..." : "Move Track"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
