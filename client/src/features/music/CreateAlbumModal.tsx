import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  X, Upload, Trash2, GripVertical, ArrowUp, ArrowDown,
  Wand2, Music, ListOrdered, ChevronDown, ChevronUp, Disc3, Image,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppSelector } from "@/store/hooks";
import { uploadAudio, uploadCoverArt } from "@/lib/api/music";
import { buildAlbumEvent, buildTrackEvent, buildPrivateAlbumEvent, buildPrivateTrackEvent } from "./musicEventBuilder";
import { signAndPublish, signAndSaveLocally } from "@/lib/nostr/publish";
import { FeaturedArtistsInput } from "./FeaturedArtistsInput";
import { HashtagInput } from "./HashtagInput";
import { GenrePicker } from "./GenrePicker";
import { VisibilityPicker } from "./VisibilityPicker";
import { useProfile } from "@/features/profile/useProfile";
import {
  parseTrackFiles,
  sortTracksByNumber,
  detectAlbumInfo,
  formatDuration,
  renumberTracks,
  findBestCover,
  cleanupTrackCovers,
} from "./trackFileParser";
import type { ParsedTrackInfo } from "./trackFileParser";
import { useResolvedArtist } from "./useResolvedArtist";
import type { MusicAlbum, MusicTrack, MusicVisibility, ProjectType } from "@/types/music";

function ExistingTrackArtist({ track }: { track: MusicTrack }) {
  const resolved = useResolvedArtist(track.artist, track.artistPubkeys);
  return <>{resolved}</>;
}

interface CreateAlbumModalProps {
  open: boolean;
  onClose: () => void;
  album?: MusicAlbum;
}

type UploadPhase = "idle" | "parsing" | "ready" | "uploading";

export function CreateAlbumModal({ open, onClose, album }: CreateAlbumModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const allTracks = useAppSelector((s) => s.music.tracks);
  const userTracks = useMemo(() => {
    if (!pubkey) return [];
    return Object.values(allTracks).filter((t) => t.pubkey === pubkey);
  }, [allTracks, pubkey]);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [genre, setGenre] = useState("");
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [selectedTrackRefs, setSelectedTrackRefs] = useState<string[]>([]);
  const [iAmArtist, setIAmArtist] = useState(true);
  const [artistPubkeys, setArtistPubkeys] = useState<string[]>([]);
  const [featuredArtists, setFeaturedArtists] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<MusicVisibility>("public");
  const [spaceId, setSpaceId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [projectType, setProjectType] = useState<ProjectType>("album");
  const [collaborators, setCollaborators] = useState<string[]>([]);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);

  // Bulk upload state
  const [parsedTracks, setParsedTracks] = useState<ParsedTrackInfo[]>([]);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [showTrackDetails, setShowTrackDetails] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const { profile: myProfile } = useProfile(pubkey);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const trackInputRef = useRef<HTMLInputElement>(null);
  const isEditing = !!album;

  // Pre-fill when editing
  useEffect(() => {
    if (album) {
      setTitle(album.title);
      setArtist(/^[0-9a-f]{64}$/i.test(album.artist) ? "" : album.artist);
      setGenre(album.genre ?? "");
      setHashtags(album.hashtags ?? []);
      setProjectType(album.projectType);
      setSelectedTrackRefs(album.trackRefs);
      setArtistPubkeys(album.artistPubkeys ?? []);
      // "I am the artist" is true only if the uploader's pubkey is in artistPubkeys.
      // Empty artistPubkeys with a custom artist name means text-only artist (not the uploader).
      setIAmArtist(
        album.artistPubkeys.includes(pubkey!) ||
        (album.artistPubkeys.length === 0 && album.artist === pubkey),
      );
      setFeaturedArtists(album.featuredArtists);
      setVisibility(album.visibility);
    } else {
      setTitle("");
      setArtist("");
      setGenre("");
      setHashtags([]);
      setProjectType("album");
      setSelectedTrackRefs([]);
      setIAmArtist(true);
      setArtistPubkeys([]);
      setFeaturedArtists([]);
      setCollaborators([]);
      setVisibility("public");
      setSpaceId("");
    }
    setCoverFile(null);
    setCoverPreview(null);
    // Clean up any existing embedded cover URLs before resetting
    cleanupTrackCovers(parsedTracks);
    setParsedTracks([]);
    setUploadPhase("idle");
    setShowTrackDetails(false);
    setError(null);
    setUploadProgress({ current: 0, total: 0 });
  }, [album, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate cover preview
  useEffect(() => {
    if (!coverFile) { setCoverPreview(null); return; }
    const url = URL.createObjectURL(coverFile);
    setCoverPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  const handleNewTrackFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    e.target.value = "";

    setUploadPhase("parsing");
    setError(null);

    try {
      const parsed = await parseTrackFiles(files);
      const sorted = sortTracksByNumber(parsed);

      setParsedTracks((prev) => {
        const combined = [...prev, ...sorted];
        return combined;
      });

      // Auto-detect album info from metadata if fields are empty
      const allTracks = [...parsedTracks, ...sorted];
      const detected = detectAlbumInfo(allTracks);
      if (!title && detected.albumTitle) setTitle(detected.albumTitle);
      if (!artist && detected.artist) setArtist(detected.artist);
      if (!genre && detected.genre) setGenre(detected.genre);

      // Auto-set album cover from embedded art if no cover is selected
      if (!coverFile) {
        const bestCover = findBestCover(allTracks);
        if (bestCover) {
          setCoverFile(bestCover.file);
          setCoverPreview(bestCover.objectUrl);
        }
      }

      setUploadPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse track files");
      setUploadPhase("idle");
    }
  }, [parsedTracks, title, artist, genre]);

  const removeTrack = (key: string) => {
    setParsedTracks((prev) => {
      const next = prev.filter((t) => t.key !== key);
      if (next.length === 0) setUploadPhase("idle");
      return next;
    });
  };

  const updateTrack = (key: string, updates: Partial<ParsedTrackInfo>) => {
    setParsedTracks((prev) =>
      prev.map((t) => (t.key === key ? { ...t, ...updates } : t)),
    );
  };

  const moveTrack = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= parsedTracks.length) return;
    setParsedTracks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  // Drag and drop handlers
  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = (idx: number) => {
    if (dragIndex !== null && dragIndex !== idx) {
      moveTrack(dragIndex, idx);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleAutoSort = () => {
    setParsedTracks((prev) => sortTracksByNumber(prev));
  };

  const handleRenumber = () => {
    setParsedTracks((prev) => renumberTracks(prev));
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

      const albumAddrId = `33123:${pubkey}:${slug}`;
      const resolvedArtistPubkeys = iAmArtist ? [pubkey] : artistPubkeys;
      const resolvedArtist = artist || myProfile?.display_name || myProfile?.name || pubkey;

      // Upload new tracks sequentially with progress
      const newTrackAddrIds: string[] = [];
      if (parsedTracks.length > 0) {
        setUploadPhase("uploading");
        setUploadProgress({ current: 0, total: parsedTracks.length });

        for (let i = 0; i < parsedTracks.length; i++) {
          const track = parsedTracks[i];
          setUploadProgress({ current: i + 1, total: parsedTracks.length });
          updateTrack(track.key, { status: "uploading" });

          try {
            const result = await uploadAudio(track.file, {
              title: track.title,
              artist: track.artist || resolvedArtist,
            });

            // Upload per-track cover art from embedded metadata
            let trackImageUrl: string | undefined;
            if (track.embeddedCover) {
              try {
                const coverResult = await uploadCoverArt(track.embeddedCover.file);
                trackImageUrl = coverResult.url;
              } catch {
                // Non-fatal: track still gets published without its own cover
              }
            } else if (imageUrl) {
              // Fall back to album cover for tracks without their own art
              trackImageUrl = imageUrl;
            }

            const trackSlug = track.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "");

            const trackParams = {
              title: track.title,
              artist: track.artist || resolvedArtist,
              slug: trackSlug,
              duration: result.duration ?? track.duration ?? undefined,
              genre: track.genre || genre || undefined,
              audioUrl: result.url,
              audioHash: result.sha256,
              audioSize: result.size,
              audioMime: result.mimeType,
              imageUrl: trackImageUrl,
              albumRef: albumAddrId,
              artistPubkeys: resolvedArtistPubkeys.length > 0 ? resolvedArtistPubkeys : undefined,
              visibility,
              spaceId: visibility === "space" ? spaceId : undefined,
              channelId: visibility === "space" && channelId ? channelId : undefined,
            };

            const trackUnsigned = visibility === "private"
              ? await buildPrivateTrackEvent(pubkey, { ...trackParams, collaborators })
              : buildTrackEvent(pubkey, trackParams);

            if (visibility === "local") {
              await signAndSaveLocally(trackUnsigned);
            } else {
              await signAndPublish(trackUnsigned);
            }

            newTrackAddrIds.push(`31683:${pubkey}:${trackSlug}`);
            updateTrack(track.key, { status: "done", uploadProgress: 100 });
          } catch (err) {
            updateTrack(track.key, {
              status: "error",
              errorMsg: err instanceof Error ? err.message : "Upload failed",
            });
          }
        }
      }

      // Combine existing selected tracks with newly created ones
      const allTrackRefs = [...selectedTrackRefs, ...newTrackAddrIds];

      const albumParams = {
        title,
        artist: resolvedArtist,
        slug,
        genre: genre || undefined,
        imageUrl,
        trackRefs: allTrackRefs.length > 0 ? allTrackRefs : undefined,
        artistPubkeys: resolvedArtistPubkeys.length > 0 ? resolvedArtistPubkeys : undefined,
        featuredArtists: featuredArtists.length > 0 ? featuredArtists : undefined,
        hashtags: hashtags.length > 0 ? hashtags : undefined,
        projectType,
        visibility,
        spaceId: visibility === "space" ? spaceId : undefined,
        channelId: visibility === "space" && channelId ? channelId : undefined,
      };

      const unsigned = visibility === "private"
        ? await buildPrivateAlbumEvent(pubkey, { ...albumParams, collaborators })
        : buildAlbumEvent(pubkey, albumParams);

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
      setUploadPhase("idle");
    }
  };

  const totalDuration = parsedTracks.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  const hasMetadata = parsedTracks.some((t) => t.hasId3);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-6 shadow-[var(--shadow-elevated)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">
            {isEditing ? "Edit Project" : "Create Project"}
          </h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          {/* Cover Art + Title Row */}
          <div className="flex gap-4">
            {/* Cover Art Thumbnail */}
            <div className="shrink-0">
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => coverInputRef.current?.click()}
                className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface transition-colors hover:border-primary/40"
              >
                {coverPreview || (isEditing && album.imageUrl) ? (
                  <img
                    src={coverPreview ?? album?.imageUrl}
                    alt="Cover"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted group-hover:text-soft">
                    <Disc3 size={20} />
                    <span className="text-[10px]">Cover Art</span>
                  </div>
                )}
              </button>
            </div>

            {/* Title + Artist */}
            <div className="flex flex-1 flex-col gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-soft">Title *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
                  placeholder="Project title"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-soft">Artist</label>
                <input
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
                />
              </div>
            </div>
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

          {/* Genre + Type Row */}
          <div className="grid grid-cols-2 gap-3">
            <GenrePicker value={genre} onChange={setGenre} />
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">Type</label>
              <select
                value={projectType}
                onChange={(e) => setProjectType(e.target.value as ProjectType)}
                className="w-full rounded-xl border border-border bg-field px-3 py-1.5 text-sm text-heading outline-none focus:border-primary/30"
              >
                <option value="album">Album</option>
                <option value="ep">EP</option>
                <option value="demo">Demo</option>
                <option value="mix">Mix</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <HashtagInput value={hashtags} onChange={setHashtags} />

          <FeaturedArtistsInput
            value={featuredArtists}
            onChange={setFeaturedArtists}
            label="Collaborators"
            placeholder="Paste npub or hex pubkey..."
          />

          {/* === BULK TRACK UPLOAD === */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-soft">
                Tracks
                {parsedTracks.length > 0 && (
                  <span className="ml-1.5 text-muted">
                    ({parsedTracks.length} track{parsedTracks.length !== 1 ? "s" : ""}
                    {totalDuration > 0 ? ` \u00B7 ${formatDuration(totalDuration)}` : ""})
                  </span>
                )}
              </label>
              {parsedTracks.length > 1 && (
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={handleAutoSort}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-soft transition-colors hover:bg-surface-hover hover:text-heading"
                    title="Sort by track number"
                  >
                    <Wand2 size={11} />
                    Auto-sort
                  </button>
                  <button
                    type="button"
                    onClick={handleRenumber}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-soft transition-colors hover:bg-surface-hover hover:text-heading"
                    title="Renumber tracks 1, 2, 3..."
                  >
                    <ListOrdered size={11} />
                    Renumber
                  </button>
                </div>
              )}
            </div>

            <input
              ref={trackInputRef}
              type="file"
              accept=".mp3,.ogg,.flac,.wav,.aac,.m4a,.webm,.mpeg"
              multiple
              className="hidden"
              onChange={handleNewTrackFiles}
            />

            {/* Upload area / drop zone */}
            {parsedTracks.length === 0 && (
              <button
                type="button"
                onClick={() => trackInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border px-4 py-6 text-sm text-soft transition-colors hover:border-primary/40 hover:text-heading"
              >
                <Upload size={20} />
                <span>Drop audio files or click to browse</span>
                <span className="text-[10px] text-muted">
                  Supports MP3, FLAC, OGG, WAV, AAC, M4A, WebM
                </span>
              </button>
            )}

            {/* Parsing indicator */}
            {uploadPhase === "parsing" && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-soft">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                <span>Reading metadata from files...</span>
              </div>
            )}

            {/* Track list */}
            {parsedTracks.length > 0 && (
              <div className="space-y-0.5">
                {/* Track header row */}
                <div className="flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wider text-muted">
                  <span className="w-5" />
                  <span className="w-7 text-center">#</span>
                  <span className="flex-1">Title</span>
                  <span className="w-12 text-right">Time</span>
                  <span className="w-28" />
                </div>

                {parsedTracks.map((track, idx) => (
                  <div
                    key={track.key}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDrop={() => handleDrop(idx)}
                    onDragEnd={handleDragEnd}
                    className={`group flex items-center gap-1.5 rounded-lg px-1 py-1 transition-colors ${
                      dragOverIndex === idx ? "bg-primary/10" : "hover:bg-surface-hover"
                    } ${track.status === "done" ? "opacity-60" : ""} ${
                      track.status === "error" ? "bg-red-500/5" : ""
                    }`}
                  >
                    {/* Drag handle */}
                    <span className="w-5 shrink-0 cursor-grab text-muted opacity-0 group-hover:opacity-100">
                      <GripVertical size={12} />
                    </span>

                    {/* Track number */}
                    <input
                      type="text"
                      value={track.trackNumber ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateTrack(track.key, {
                          trackNumber: v ? parseInt(v, 10) || null : null,
                        });
                      }}
                      className="w-7 shrink-0 rounded bg-transparent px-0.5 py-0.5 text-center text-xs text-muted outline-none focus:bg-field focus:text-heading"
                      placeholder="-"
                    />

                    {/* Cover thumbnail (detail view) */}
                    {showTrackDetails && track.embeddedCover && (
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded">
                        <img
                          src={track.embeddedCover.objectUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}

                    {/* Title + artist (expandable) */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      <input
                        type="text"
                        value={track.title}
                        onChange={(e) => updateTrack(track.key, { title: e.target.value })}
                        className="w-full truncate rounded bg-transparent px-1 py-0.5 text-xs text-heading outline-none focus:bg-field"
                        placeholder="Track title"
                      />
                      {showTrackDetails && (
                        <input
                          type="text"
                          value={track.artist}
                          onChange={(e) => updateTrack(track.key, { artist: e.target.value })}
                          className="w-full truncate rounded bg-transparent px-1 py-0.5 text-[10px] text-muted outline-none focus:bg-field focus:text-heading"
                          placeholder="Artist"
                        />
                      )}
                      {track.status === "error" && (
                        <span className="px-1 text-[10px] text-red-400">{track.errorMsg}</span>
                      )}
                    </div>

                    {/* Duration */}
                    <span className="w-12 shrink-0 text-right text-[10px] text-muted">
                      {formatDuration(track.duration)}
                    </span>

                    {/* Status / Actions */}
                    <div className="flex w-28 shrink-0 items-center justify-end gap-1">
                      {track.status === "uploading" && (
                        <div className="h-3 w-3 animate-spin rounded-full border border-primary/30 border-t-primary" />
                      )}
                      {track.status === "done" && (
                        <span className="text-[10px] text-green-400">Done</span>
                      )}
                      {track.hasId3 && track.status === "pending" && (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary" title="Has ID3 metadata">
                          ID3
                        </span>
                      )}
                      {track.embeddedCover && track.status === "pending" && !showTrackDetails && (
                        <span className="text-muted" title="Has embedded cover art">
                          <Image size={9} />
                        </span>
                      )}
                      {track.status === "pending" && (
                        <>
                          <button
                            type="button"
                            onClick={() => moveTrack(idx, idx - 1)}
                            disabled={idx === 0}
                            className="p-0.5 text-muted opacity-0 transition-opacity hover:text-heading group-hover:opacity-100 disabled:invisible"
                          >
                            <ArrowUp size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTrack(idx, idx + 1)}
                            disabled={idx === parsedTracks.length - 1}
                            className="p-0.5 text-muted opacity-0 transition-opacity hover:text-heading group-hover:opacity-100 disabled:invisible"
                          >
                            <ArrowDown size={10} />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTrack(track.key)}
                            className="p-0.5 text-muted opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 size={10} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}

                {/* Bottom controls */}
                <div className="flex items-center gap-2 pt-1.5">
                  <button
                    type="button"
                    onClick={() => trackInputRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
                  >
                    <Upload size={12} />
                    Add more
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTrackDetails((v) => !v)}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-muted transition-colors hover:bg-surface-hover hover:text-soft"
                  >
                    {showTrackDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                    {showTrackDetails ? "Less detail" : "More detail"}
                  </button>
                  {hasMetadata && (
                    <span className="ml-auto text-[10px] text-muted">
                      <Music size={10} className="mr-0.5 inline" />
                      Metadata auto-detected
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Existing tracks selection */}
          {userTracks.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">Existing Tracks</label>
              <div className="max-h-32 overflow-y-auto rounded-xl border border-border bg-field p-2">
                {userTracks.map((track) => (
                  <label
                    key={track.addressableId}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-heading hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTrackRefs.includes(track.addressableId)}
                      onChange={() => toggleTrack(track.addressableId)}
                      className="h-4 w-4 rounded border-2 border-border bg-field checked:bg-primary checked:border-primary accent-purple-400"
                    />
                    <span className="truncate">{track.title}</span>
                    <span className="ml-auto text-xs text-muted"><ExistingTrackArtist track={track} /></span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
              label="Private Collaborators (can view this project)"
              placeholder="Paste collaborator npub or hex pubkey..."
            />
          )}

          {/* Upload progress bar */}
          {submitting && uploadProgress.total > 0 && (
            <div>
              <div className="mb-1 flex justify-between text-[10px] text-muted">
                <span>Uploading tracks...</span>
                <span>{uploadProgress.current} / {uploadProgress.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-primary-soft transition-all duration-300"
                  style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!title.trim() || submitting || (visibility === "space" && !spaceId)}
            className="w-full rounded-xl bg-gradient-to-r from-primary to-primary-soft py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 press-effect disabled:opacity-50"
          >
            {submitting
              ? uploadProgress.total > 0
                ? `Uploading ${uploadProgress.current}/${uploadProgress.total}...`
                : isEditing ? "Saving..." : "Creating..."
              : visibility === "local"
                ? isEditing ? "Save Changes" : "Save Locally"
                : isEditing ? "Save Changes" : "Create Project"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
