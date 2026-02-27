import { useState, useRef, useEffect } from "react";
import { X, Upload, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadAudio, uploadCoverArt } from "@/lib/api/music";
import { buildAlbumEvent, buildTrackEvent } from "./musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { FeaturedArtistsInput } from "./FeaturedArtistsInput";
import { VisibilityPicker } from "./VisibilityPicker";
import type { MusicAlbum, MusicVisibility, ProjectType } from "@/types/music";

interface CreateAlbumModalProps {
  open: boolean;
  onClose: () => void;
  album?: MusicAlbum;
}

export function CreateAlbumModal({ open, onClose, album }: CreateAlbumModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const userTracks = useAppSelector((s) => {
    if (!pubkey) return [];
    return Object.values(s.music.tracks).filter((t) => t.pubkey === pubkey);
  });
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [selectedTrackRefs, setSelectedTrackRefs] = useState<string[]>([]);
  const [featuredArtists, setFeaturedArtists] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<MusicVisibility>("public");
  const [spaceId, setSpaceId] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("album");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [newTrackFiles, setNewTrackFiles] = useState<File[]>([]);
  const [newTrackTitles, setNewTrackTitles] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const trackInputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!album;

  // Pre-fill when editing
  useEffect(() => {
    if (album) {
      setTitle(album.title);
      setArtist(album.artist);
      setGenre(album.genre ?? "");
      setProjectType(album.projectType);
      setSelectedTrackRefs(album.trackRefs);
      setFeaturedArtists(album.featuredArtists);
      setVisibility(album.visibility);
    } else {
      setTitle("");
      setArtist("");
      setGenre("");
      setProjectType("album");
      setSelectedTrackRefs([]);
      setFeaturedArtists([]);
      setVisibility("public");
      setSpaceId("");
    }
    setCoverFile(null);
    setNewTrackFiles([]);
    setNewTrackTitles({});
    setError(null);
  }, [album, open]);

  const handleNewTrackFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setNewTrackFiles((prev) => [...prev, ...files]);
    const titles: Record<string, string> = {};
    for (const f of files) {
      // Pre-fill title from filename minus extension
      titles[f.name] = f.name.replace(/\.[^.]+$/, "");
    }
    setNewTrackTitles((prev) => ({ ...prev, ...titles }));
    e.target.value = "";
  };

  const removeNewTrack = (fileName: string) => {
    setNewTrackFiles((prev) => prev.filter((f) => f.name !== fileName));
    setNewTrackTitles((prev) => {
      const next = { ...prev };
      delete next[fileName];
      return next;
    });
  };

  const toggleTrack = (addrId: string) => {
    setSelectedTrackRefs((prev) =>
      prev.includes(addrId) ? prev.filter((id) => id !== addrId) : [...prev, addrId],
    );
  };

  const handleSubmit = async () => {
    if (!pubkey || !title.trim()) return;
    setError(null);
    setSubmitting(true);

    try {
      let imageUrl: string | undefined;
      if (coverFile) {
        const result = await uploadCoverArt(coverFile);
        imageUrl = result.url;
      } else if (isEditing) {
        imageUrl = album.imageUrl;
      }

      const slug = isEditing
        ? album.addressableId.split(":").slice(2).join(":")
        : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      // Compute the project's addressable ID for album refs on new tracks
      const albumAddrId = `33123:${pubkey}:${slug}`;

      // Upload new tracks in parallel
      const newTrackAddrIds: string[] = [];
      if (newTrackFiles.length > 0) {
        const uploadResults = await Promise.all(
          newTrackFiles.map((file) =>
            uploadAudio(file, {
              title: newTrackTitles[file.name] ?? file.name,
              artist: artist || pubkey,
            }),
          ),
        );

        // Build and publish track events
        for (let i = 0; i < newTrackFiles.length; i++) {
          const file = newTrackFiles[i];
          const result = uploadResults[i];
          const trackTitle = newTrackTitles[file.name] ?? file.name.replace(/\.[^.]+$/, "");
          const trackSlug = trackTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

          const trackUnsigned = buildTrackEvent(pubkey, {
            title: trackTitle,
            artist: artist || pubkey,
            slug: trackSlug,
            genre: genre || undefined,
            audioUrl: result.url,
            audioHash: result.sha256,
            audioSize: result.size,
            audioMime: result.mimeType,
            albumRef: albumAddrId,
            visibility,
            spaceId: visibility === "space" ? spaceId : undefined,
          });

          if (visibility === "local") {
            await signAndSaveLocally(trackUnsigned);
          } else {
            await signAndPublish(trackUnsigned);
          }
          newTrackAddrIds.push(`31683:${pubkey}:${trackSlug}`);
        }
      }

      // Combine existing selected tracks with newly created ones
      const allTrackRefs = [...selectedTrackRefs, ...newTrackAddrIds];

      const unsigned = buildAlbumEvent(pubkey, {
        title,
        artist: artist || pubkey,
        slug,
        genre: genre || undefined,
        imageUrl,
        trackRefs: allTrackRefs.length > 0 ? allTrackRefs : undefined,
        featuredArtists: featuredArtists.length > 0 ? featuredArtists : undefined,
        projectType,
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
      setError(err instanceof Error ? err.message : "Failed to save project");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-white/[0.04] card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">
            {isEditing ? "Edit Project" : "Create Project"}
          </h2>
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
              placeholder="Project title"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Artist</label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Genre</label>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Type</label>
            <select
              value={projectType}
              onChange={(e) => setProjectType(e.target.value as ProjectType)}
              className="w-full rounded-xl border border-white/[0.04] bg-white/[0.04] px-3 py-1.5 text-sm text-heading outline-none focus:border-pulse/30"
            >
              <option value="album">Album</option>
              <option value="ep">EP</option>
              <option value="demo">Demo</option>
              <option value="mix">Mix</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Collaborators */}
          <FeaturedArtistsInput
            value={featuredArtists}
            onChange={setFeaturedArtists}
            label="Collaborators"
            placeholder="Paste npub or hex pubkey..."
          />

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
                : isEditing && album.imageUrl
                  ? "Replace cover image"
                  : "Choose image (optional)"}
            </button>
          </div>

          {/* Track selection */}
          {userTracks.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">Tracks</label>
              <div className="max-h-40 overflow-y-auto rounded-xl border border-white/[0.04] bg-white/[0.04] p-2">
                {userTracks.map((track) => (
                  <label
                    key={track.addressableId}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-heading hover:bg-white/[0.03]"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTrackRefs.includes(track.addressableId)}
                      onChange={() => toggleTrack(track.addressableId)}
                      className="accent-heading"
                    />
                    <span className="truncate">{track.title}</span>
                    <span className="ml-auto text-xs text-muted">{track.artist}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Upload new tracks */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">Upload New Tracks</label>
            <input
              ref={trackInputRef}
              type="file"
              accept=".mp3,.ogg,.flac,.wav,.aac,.m4a,.webm,.mpeg"
              multiple
              className="hidden"
              onChange={handleNewTrackFiles}
            />
            <button
              type="button"
              onClick={() => trackInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-xl border border-dashed border-white/[0.04] px-4 py-2 text-sm text-soft transition-colors hover:border-pulse/40 hover:text-heading"
            >
              <Upload size={16} />
              <span>Choose audio files</span>
            </button>
            {newTrackFiles.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {newTrackFiles.map((file) => (
                  <div key={file.name} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newTrackTitles[file.name] ?? ""}
                      onChange={(e) =>
                        setNewTrackTitles((prev) => ({ ...prev, [file.name]: e.target.value }))
                      }
                      className="flex-1 rounded-xl border border-white/[0.04] bg-white/[0.04] px-2 py-1 text-xs text-heading outline-none focus:border-pulse/30"
                      placeholder="Track title"
                    />
                    <button
                      type="button"
                      onClick={() => removeNewTrack(file.name)}
                      className="shrink-0 text-soft hover:text-red-400"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
            disabled={!title.trim() || submitting || (visibility === "space" && !spaceId)}
            className="w-full rounded-xl bg-gradient-to-r from-pulse to-pulse-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting
              ? isEditing ? "Saving..." : "Creating..."
              : visibility === "local"
                ? isEditing ? "Save Changes" : "Save Locally"
                : isEditing ? "Save Changes" : "Create Project"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
