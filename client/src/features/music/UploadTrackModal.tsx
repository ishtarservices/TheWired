import { useState, useRef } from "react";
import { X, Upload, Music } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadAudio, uploadCoverArt } from "@/lib/api/music";
import { buildTrackEvent } from "./musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { FeaturedArtistsInput } from "./FeaturedArtistsInput";
import { VisibilityPicker } from "./VisibilityPicker";
import type { MusicVisibility } from "@/types/music";

const ALLOWED_AUDIO_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/flac",
  "audio/wav",
  "audio/x-wav",
  "audio/aac",
  "audio/mp4",
  "audio/webm",
]);

interface UploadTrackModalProps {
  open: boolean;
  onClose: () => void;
  defaultAlbumRef?: string;
}

export function UploadTrackModal({ open, onClose, defaultAlbumRef }: UploadTrackModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const ownAlbums = useAppSelector((s) => {
    if (!pubkey) return [];
    return Object.values(s.music.albums).filter((a) => a.pubkey === pubkey);
  });
  const collabAlbums = useAppSelector((s) => {
    if (!pubkey) return [];
    return Object.values(s.music.albums).filter(
      (a) => a.pubkey !== pubkey && a.featuredArtists.includes(pubkey),
    );
  });
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [albumRef, setAlbumRef] = useState(defaultAlbumRef ?? "");
  const [featuredArtists, setFeaturedArtists] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<MusicVisibility>("public");
  const [spaceId, setSpaceId] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      setError("Invalid audio format. Supported: MP3, OGG, FLAC, WAV, AAC, M4A, WebM");
      setAudioFile(null);
      e.target.value = "";
      return;
    }
    setError(null);
    setAudioFile(file);
  };

  const handleSubmit = async () => {
    if (!audioFile || !pubkey || !title.trim()) return;
    setError(null);
    setUploading(true);

    try {
      // Upload audio
      const audioResult = await uploadAudio(audioFile, { title, artist });

      // Upload cover if provided
      let imageUrl: string | undefined;
      if (coverFile) {
        const coverResult = await uploadCoverArt(coverFile);
        imageUrl = coverResult.url;
      }

      // Build and publish the track event
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const unsigned = buildTrackEvent(pubkey, {
        title,
        artist: artist || pubkey,
        slug,
        duration: audioResult.duration,
        genre: genre || undefined,
        audioUrl: audioResult.url,
        audioHash: audioResult.sha256,
        audioSize: audioResult.size,
        audioMime: audioResult.mimeType,
        imageUrl,
        albumRef: albumRef || undefined,
        featuredArtists: featuredArtists.length > 0 ? featuredArtists : undefined,
        visibility,
        spaceId: visibility === "space" ? spaceId : undefined,
      });

      if (visibility === "local") {
        await signAndSaveLocally(unsigned);
      } else {
        await signAndPublish(unsigned);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-white/[0.04] card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">Upload Track</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Audio file */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Audio File *
            </label>
            <input
              ref={audioInputRef}
              type="file"
              accept=".mp3,.ogg,.flac,.wav,.aac,.m4a,.webm,.mpeg"
              className="hidden"
              onChange={handleAudioChange}
            />
            <button
              onClick={() => audioInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/[0.04] px-4 py-3 text-sm text-soft transition-colors hover:border-pulse/40 hover:text-heading"
            >
              {audioFile ? (
                <>
                  <Music size={16} />
                  <span className="truncate">{audioFile.name}</span>
                </>
              ) : (
                <>
                  <Upload size={16} />
                  <span>Choose audio file</span>
                </>
              )}
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="Track title"
            />
          </div>

          {/* Artist */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Artist
            </label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="Artist name"
            />
          </div>

          {/* Genre */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Genre
            </label>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
              placeholder="e.g. Electronic, Rock, Jazz"
            />
          </div>

          {/* Project */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Project
            </label>
            <select
              value={albumRef}
              onChange={(e) => setAlbumRef(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
            >
              <option value="">None (single)</option>
              {ownAlbums.length > 0 && (
                <optgroup label="My Projects">
                  {ownAlbums.map((a) => (
                    <option key={a.addressableId} value={a.addressableId}>
                      {a.title}
                    </option>
                  ))}
                </optgroup>
              )}
              {collabAlbums.length > 0 && (
                <optgroup label="Collaborations">
                  {collabAlbums.map((a) => (
                    <option key={a.addressableId} value={a.addressableId}>
                      {a.title} — {a.artist}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Featured Artists */}
          <FeaturedArtistsInput value={featuredArtists} onChange={setFeaturedArtists} />

          {/* Cover art */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Cover Art
            </label>
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
              {coverFile ? coverFile.name : "Choose image (optional)"}
            </button>
          </div>

          {/* Visibility */}
          <VisibilityPicker
            value={visibility}
            onChange={setVisibility}
            spaceId={spaceId}
            onSpaceIdChange={setSpaceId}
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!audioFile || !title.trim() || uploading || (visibility === "space" && !spaceId)}
            className="w-full rounded-xl bg-gradient-to-r from-pulse to-pulse-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {uploading
              ? "Uploading..."
              : visibility === "local"
                ? "Save Locally"
                : "Upload & Publish"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
