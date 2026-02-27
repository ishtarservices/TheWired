import { useState, useRef } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadCoverArt } from "@/lib/api/music";
import { buildTrackEvent } from "./musicEventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { selectAudioSource } from "./trackParser";
import { FeaturedArtistsInput } from "./FeaturedArtistsInput";
import type { MusicTrack } from "@/types/music";

interface EditTrackModalProps {
  track: MusicTrack;
  onClose: () => void;
}

export function EditTrackModal({ track, onClose }: EditTrackModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const userAlbums = useAppSelector((s) => {
    if (!pubkey) return [];
    return Object.values(s.music.albums).filter((a) => a.pubkey === pubkey);
  });
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  const [genre, setGenre] = useState(track.genre ?? "");
  const [albumRef, setAlbumRef] = useState(track.albumRef ?? "");
  const [featuredArtists, setFeaturedArtists] = useState<string[]>(track.featuredArtists);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!pubkey || !title.trim()) return;
    setError(null);
    setSubmitting(true);

    try {
      // Preserve existing audio URL
      const audioUrl = selectAudioSource(track.variants);
      if (!audioUrl) {
        setError("Could not resolve audio URL from track");
        setSubmitting(false);
        return;
      }

      // Upload new cover if provided, otherwise keep existing
      let imageUrl = track.imageUrl;
      if (coverFile) {
        const result = await uploadCoverArt(coverFile);
        imageUrl = result.url;
      }

      // Extract existing d-tag to publish as replacement
      const existingDTag = track.addressableId.split(":").slice(2).join(":");

      const unsigned = buildTrackEvent(pubkey, {
        title,
        artist: artist || pubkey,
        slug: existingDTag,
        duration: track.duration,
        genre: genre || undefined,
        audioUrl,
        imageUrl,
        albumRef: albumRef || undefined,
        featuredArtists: featuredArtists.length > 0 ? featuredArtists : undefined,
        visibility: track.visibility,
      });

      await signAndPublish(unsigned);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/[0.04] card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">Edit Track</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="Track title"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Artist</label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="Artist name"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Genre</label>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="e.g. Electronic, Rock, Jazz"
            />
          </div>

          {/* Album */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Album</label>
            <select
              value={albumRef}
              onChange={(e) => setAlbumRef(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
            >
              <option value="">None (single)</option>
              {userAlbums.map((a) => (
                <option key={a.addressableId} value={a.addressableId}>
                  {a.title}
                </option>
              ))}
            </select>
          </div>

          {/* Featured Artists */}
          <FeaturedArtistsInput value={featuredArtists} onChange={setFeaturedArtists} />

          {/* Cover art */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Cover Art</label>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
            <button
              onClick={() => coverInputRef.current?.click()}
              className="text-xs text-soft hover:text-heading"
            >
              {coverFile
                ? coverFile.name
                : track.imageUrl
                  ? "Replace cover image"
                  : "Choose image (optional)"}
            </button>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-pulse to-pulse-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
