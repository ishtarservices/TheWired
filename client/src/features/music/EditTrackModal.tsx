import { useState, useRef, useMemo } from "react";
import { X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadCoverArt } from "@/lib/api/music";
import { buildTrackEvent, buildPrivateTrackEvent } from "./musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { selectAudioSource } from "./trackParser";
import { FeaturedArtistsInput } from "./FeaturedArtistsInput";
import { HashtagInput } from "./HashtagInput";
import { GenrePicker } from "./GenrePicker";
import { VisibilityPicker } from "./VisibilityPicker";
import { useProfile } from "@/features/profile/useProfile";
import type { MusicTrack } from "@/types/music";
import type { MusicVisibility } from "@/types/music";

interface EditTrackModalProps {
  track: MusicTrack;
  onClose: () => void;
}

export function EditTrackModal({ track, onClose }: EditTrackModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const allAlbums = useAppSelector((s) => s.music.albums);
  const userAlbums = useMemo(() => {
    if (!pubkey) return [];
    return Object.values(allAlbums).filter((a) => a.pubkey === pubkey);
  }, [allAlbums, pubkey]);
  const [title, setTitle] = useState(track.title);
  // Don't pre-fill hex pubkeys in the artist input — the profile name
  // will be used as fallback on submit via the prevention logic.
  const [artist, setArtist] = useState(
    /^[0-9a-f]{64}$/i.test(track.artist) ? "" : track.artist,
  );
  const [genre, setGenre] = useState(track.genre ?? "");
  const [hashtags, setHashtags] = useState<string[]>(track.hashtags);
  const [albumRef, setAlbumRef] = useState(track.albumRef ?? "");
  const [iAmArtist, setIAmArtist] = useState(
    track.artistPubkeys.includes(pubkey!) ||
    (track.artistPubkeys.length === 0 && track.artist === pubkey),
  );
  const [artistPubkeys, setArtistPubkeys] = useState<string[]>(
    track.artistPubkeys.filter((pk) => pk !== pubkey),
  );
  const [featuredArtists, setFeaturedArtists] = useState<string[]>(track.featuredArtists);
  const [visibility, setVisibility] = useState<MusicVisibility>(track.visibility);
  const [spaceId, setSpaceId] = useState(track.spaceId ?? "");
  const [channelId, setChannelId] = useState(track.channelId ?? "");
  const [collaborators, setCollaborators] = useState<string[]>(track.collaborators);
  const { profile: myProfile } = useProfile(pubkey);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [revisionSummary, setRevisionSummary] = useState("");
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

      const resolvedArtistPubkeys = iAmArtist ? [pubkey] : artistPubkeys;

      const resolvedArtist = artist || myProfile?.display_name || myProfile?.name || pubkey;
      const eventParams = {
        title,
        artist: resolvedArtist,
        slug: existingDTag,
        duration: track.duration,
        genre: genre || undefined,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        audioUrl,
        imageUrl,
        albumRef: albumRef || undefined,
        artistPubkeys: resolvedArtistPubkeys.length > 0 ? resolvedArtistPubkeys : undefined,
        featuredArtists: featuredArtists.length > 0 ? featuredArtists : undefined,
        visibility,
        spaceId: visibility === "space" ? spaceId : undefined,
        channelId: visibility === "space" && channelId ? channelId : undefined,
        revisionSummary: revisionSummary.trim() || undefined,
      };

      const unsigned = visibility === "private"
        ? await buildPrivateTrackEvent(pubkey, { ...eventParams, collaborators })
        : buildTrackEvent(pubkey, eventParams);

      if (visibility === "local") {
        await signAndSaveLocally(unsigned);
      } else {
        await signAndPublish(unsigned);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] rounded-2xl border border-border card-glass shadow-xl flex flex-col">
        <div className="shrink-0 flex items-center justify-between p-6 pb-0 mb-4">
          <h2 className="text-lg font-semibold text-heading">Edit Track</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 pb-6">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
              placeholder="Track title"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Artist</label>
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

          <GenrePicker value={genre} onChange={setGenre} />

          <HashtagInput value={hashtags} onChange={setHashtags} />

          {/* Album */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Album</label>
            <select
              value={albumRef}
              onChange={(e) => setAlbumRef(e.target.value)}
              className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
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
              placeholder="e.g. Fixed vocal mix, updated cover art..."
              maxLength={200}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting || (visibility === "space" && !spaceId)}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting
              ? "Saving..."
              : visibility === "local"
                ? "Save Locally"
                : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
