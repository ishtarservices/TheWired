import { useState, useRef, useMemo } from "react";
import { X, Upload, Music } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadAudio, uploadCoverArt } from "@/lib/api/music";
import { buildTrackEvent, buildPrivateTrackEvent } from "./musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { FeaturedArtistsInput } from "./FeaturedArtistsInput";
import { HashtagInput } from "./HashtagInput";
import { GenrePicker } from "./GenrePicker";
import { VisibilityPicker } from "./VisibilityPicker";
import { readAudioMetadata } from "./trackFileParser";
import { parseFilename } from "./trackFileParser";
import { useProfile } from "@/features/profile/useProfile";
import type { EmbeddedCoverArt } from "./trackFileParser";
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
  defaultVisibility?: MusicVisibility;
  defaultSpaceId?: string;
  defaultChannelId?: string;
}

export function UploadTrackModal({ open, onClose, defaultAlbumRef, defaultVisibility, defaultSpaceId, defaultChannelId }: UploadTrackModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const allAlbums = useAppSelector((s) => s.music.albums);
  const ownAlbums = useMemo(() => {
    if (!pubkey) return [];
    return Object.values(allAlbums).filter((a) => a.pubkey === pubkey);
  }, [allAlbums, pubkey]);
  const collabAlbums = useMemo(() => {
    if (!pubkey) return [];
    return Object.values(allAlbums).filter(
      (a) => a.pubkey !== pubkey && a.featuredArtists.includes(pubkey),
    );
  }, [allAlbums, pubkey]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [albumRef, setAlbumRef] = useState(defaultAlbumRef ?? "");
  const [iAmArtist, setIAmArtist] = useState(true);
  const [artistPubkeys, setArtistPubkeys] = useState<string[]>([]);
  const [featuredArtists, setFeaturedArtists] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<MusicVisibility>(defaultVisibility ?? "public");
  const [spaceId, setSpaceId] = useState(defaultSpaceId ?? "");
  const [channelId, setChannelId] = useState(defaultChannelId ?? "");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [embeddedCover, setEmbeddedCover] = useState<EmbeddedCoverArt | null>(null);
  const { profile: myProfile } = useProfile(pubkey);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle("");
    setArtist("");
    setGenre("");
    setHashtags([]);
    setAlbumRef(defaultAlbumRef ?? "");
    setIAmArtist(true);
    setArtistPubkeys([]);
    setFeaturedArtists([]);
    setVisibility(defaultVisibility ?? "public");
    setSpaceId(defaultSpaceId ?? "");
    setChannelId(defaultChannelId ?? "");
    setAudioFile(null);
    setCoverFile(null);
    setError(null);
    setCollaborators([]);
    setEmbeddedCover(null);
    if (audioInputRef.current) audioInputRef.current.value = "";
    if (coverInputRef.current) coverInputRef.current.value = "";
  };

  const handleAudioChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && !ALLOWED_AUDIO_TYPES.has(file.type)) {
      setError("Invalid audio format. Supported: MP3, OGG, FLAC, WAV, AAC, M4A, WebM");
      setAudioFile(null);
      e.target.value = "";
      return;
    }
    setError(null);
    setAudioFile(file);

    if (file) {
      // Auto-fill metadata from ID3 tags
      const meta = await readAudioMetadata(file);
      const fromFilename = parseFilename(file.name);
      if (!title) setTitle(meta.title || fromFilename.title);
      if (!artist) setArtist(meta.artist || fromFilename.artist);
      if (!genre && meta.genre) setGenre(meta.genre);

      // Extract embedded cover art
      if (meta.coverArt && !coverFile) {
        setEmbeddedCover(meta.coverArt);
        setCoverFile(meta.coverArt.file);
      }
    }
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
      // Compute artist pubkeys for the event
      const resolvedArtistPubkeys = iAmArtist ? [pubkey] : artistPubkeys;

      const resolvedArtist = artist || myProfile?.display_name || myProfile?.name || pubkey;
      const eventParams = {
        title,
        artist: resolvedArtist,
        slug,
        duration: audioResult.duration,
        genre: genre || undefined,
        audioUrl: audioResult.url,
        audioHash: audioResult.sha256,
        audioSize: audioResult.size,
        audioMime: audioResult.mimeType,
        imageUrl,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        albumRef: albumRef || undefined,
        artistPubkeys: resolvedArtistPubkeys.length > 0 ? resolvedArtistPubkeys : undefined,
        featuredArtists: featuredArtists.length > 0 ? featuredArtists : undefined,
        visibility,
        spaceId: visibility === "space" ? spaceId : undefined,
        channelId: visibility === "space" && channelId ? channelId : undefined,
      };

      const unsigned = visibility === "private"
        ? await buildPrivateTrackEvent(pubkey, { ...eventParams, collaborators })
        : buildTrackEvent(pubkey, eventParams);

      if (visibility === "local") {
        await signAndSaveLocally(unsigned);
      } else {
        await signAndPublish(unsigned);
      }
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] rounded-2xl border border-border card-glass shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between p-6 pb-0 mb-4">
          <h2 className="text-lg font-semibold text-heading">Upload Track</h2>
          <div className="flex items-center gap-2">
            {(audioFile || title || artist) && (
              <button onClick={resetForm} className="text-xs text-soft hover:text-heading">
                Clear
              </button>
            )}
            <button onClick={onClose} className="text-soft hover:text-heading">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 pb-6">
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
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-soft transition-colors hover:border-primary/40 hover:text-heading"
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
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
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
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
              placeholder="Artist name"
            />
          </div>

          {/* Artist identity */}
          <label className="flex items-center gap-2 text-xs text-soft">
            <input
              type="checkbox"
              checked={iAmArtist}
              onChange={(e) => setIAmArtist(e.target.checked)}
              className="h-4 w-4 rounded border-2 border-border bg-field checked:bg-primary checked:border-primary accent-purple-400"
            />
            I am the artist
          </label>

          {!iAmArtist && (
            <FeaturedArtistsInput
              value={artistPubkeys}
              onChange={setArtistPubkeys}
              label="Artist Identity (npub)"
              placeholder="Paste artist npub or hex pubkey..."
            />
          )}

          {/* Genre */}
          <GenrePicker value={genre} onChange={setGenre} />

          {/* Hashtags */}
          <HashtagInput value={hashtags} onChange={setHashtags} />

          {/* Project */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Project
            </label>
            <select
              value={albumRef}
              onChange={(e) => setAlbumRef(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
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
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setCoverFile(f);
                if (f) setEmbeddedCover(null); // User picked a file, discard embedded
              }}
            />
            <div className="flex items-center gap-2">
              {(embeddedCover || coverFile) && (
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border">
                  <img
                    src={embeddedCover?.objectUrl ?? (coverFile ? URL.createObjectURL(coverFile) : "")}
                    alt="Cover"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <button
                onClick={() => coverInputRef.current?.click()}
                className="text-xs text-soft hover:text-heading"
              >
                {embeddedCover
                  ? "Embedded cover (click to replace)"
                  : coverFile
                    ? coverFile.name
                    : "Choose image (optional)"}
              </button>
            </div>
          </div>

          {/* Visibility */}
          <VisibilityPicker
            value={visibility}
            onChange={setVisibility}
            spaceId={spaceId}
            onSpaceIdChange={setSpaceId}
            channelId={channelId}
            onChannelIdChange={setChannelId}
          />

          {/* Collaborators (for private visibility) */}
          {visibility === "private" && (
            <FeaturedArtistsInput
              value={collaborators}
              onChange={setCollaborators}
              label="Collaborators (can view this private track)"
              placeholder="Paste collaborator npub or hex pubkey..."
            />
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!audioFile || !title.trim() || uploading || (visibility === "space" && !spaceId)}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
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
