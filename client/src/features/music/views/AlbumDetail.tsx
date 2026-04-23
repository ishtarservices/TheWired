import { useMemo, useState, useRef, useEffect } from "react";
import { ArrowLeft, Play, Shuffle, Disc3, Link2, Heart, Plus, Check, Trash2, Users, UserPlus, X, Clock, RefreshCw, Pencil, Search } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { goBack, setActiveDetailId } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";
import { useLibrary } from "../useLibrary";
import { buildMusicLink } from "../musicLinks";
import { buildAlbumEvent, buildPrivateAlbumEvent } from "../musicEventBuilder";
import { copyToClipboard } from "@/lib/clipboard";
import { signAndPublish } from "@/lib/nostr/publish";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useUserSearch } from "@/features/search/useUserSearch";
import { useSavedVersions } from "../useSavedVersions";
import { ReleaseNotesModal } from "../ReleaseNotesModal";
import { CreateAlbumModal } from "../CreateAlbumModal";
import { AnnotationsPanel } from "../AnnotationsPanel";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { useResolvedArtist, resolveArtistDetailTarget } from "../useResolvedArtist";

function CollaboratorRow({
  pubkey,
  isOwner,
  onRemove,
}: {
  pubkey: string;
  isOwner: boolean;
  onRemove?: () => void;
}) {
  const dispatch = useAppDispatch();
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface">
      <button
        type="button"
        onClick={() => dispatch(setActiveDetailId({ view: "artist-detail", id: pubkey }))}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title="View artist"
      >
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <span className="flex-1 truncate text-sm text-body hover:text-heading">{name}</span>
      </button>
      {isOwner && onRemove && (
        <button
          onClick={onRemove}
          className="shrink-0 rounded p-0.5 text-muted hover:text-red-400 transition-colors"
          title="Remove collaborator"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function AlbumDetail() {
  const dispatch = useAppDispatch();
  const albumId = useAppSelector((s) => s.music.activeDetailId);
  const album = useAppSelector((s) =>
    albumId ? s.music.albums[albumId] : undefined,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) =>
    albumId ? s.music.tracksByAlbum[albumId] : undefined,
  );
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { playQueue } = useAudioPlayer();
  const { saveTrack, saveAlbum, unsaveAlbum, isAlbumSaved, favoriteAlbum, unfavoriteAlbum, isAlbumFavorited } = useLibrary();
  const { savedVersions, acknowledgeUpdate } = useSavedVersions();
  const hasUpdate = albumId ? savedVersions[albumId]?.hasUpdate ?? false : false;
  const [copied, setCopied] = useState(false);
  const [showReleaseNotes, setShowReleaseNotes] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const savedTrackIds = useAppSelector((s) => s.music.library.savedTrackIds);
  const savedAlbumIds = useAppSelector((s) => s.music.library.savedAlbumIds);
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const resolvedArtist = useResolvedArtist(album?.artist ?? "", album?.artistPubkeys);

  // All tracks in this album (catalog-level)
  const allAlbumTracks = useMemo(() => {
    const refs = album?.trackRefs ?? tracksByAlbum ?? [];
    return refs.map((id) => tracks[id]).filter(Boolean);
  }, [album?.trackRefs, tracksByAlbum, tracks]);

  // For non-owner albums that are in the user's library, filter to only saved tracks.
  // Owner/collaborator albums and albums being browsed (not in library) show all tracks.
  const isOwnerOrCollab = !!pubkey && (
    pubkey === album?.pubkey ||
    (album?.featuredArtists.includes(pubkey) ?? false) ||
    (album?.collaborators.includes(pubkey) ?? false)
  );
  const albumInLibrary = albumId ? savedAlbumIds.includes(albumId) : false;
  const shouldFilterByLibrary = !isOwnerOrCollab && albumInLibrary;

  const albumTracks = useMemo(() => {
    if (!shouldFilterByLibrary) return allAlbumTracks;
    return allAlbumTracks.filter((t) => savedTrackIds.includes(t.addressableId));
  }, [allAlbumTracks, shouldFilterByLibrary, savedTrackIds]);

  // Count of album tracks not yet in library (for "Add remaining" button)
  const unsavedTrackCount = useMemo(() => {
    if (!shouldFilterByLibrary) return 0;
    return allAlbumTracks.length - albumTracks.length;
  }, [shouldFilterByLibrary, allAlbumTracks.length, albumTracks.length]);

  if (!album) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Album not found</p>
      </div>
    );
  }

  const queueIds = albumTracks.map((t) => t.addressableId);
  const isOwner = pubkey === album.pubkey;
  const isCollaborator = !!pubkey && (
    album.featuredArtists.includes(pubkey) || album.collaborators.includes(pubkey)
  );
  // All collaborator-type pubkeys for the members list
  const collaborators = [...new Set([...album.featuredArtists, ...album.collaborators])];

  const republishAlbum = async (newCollaborators: string[]) => {
    if (!pubkey || !isOwner) return;
    const slug = album.addressableId.split(":").slice(2).join(":");
    const albumParams = {
      title: album.title,
      artist: album.artist,
      slug,
      genre: album.genre || undefined,
      imageUrl: album.imageUrl,
      trackRefs: album.trackRefs.length > 0 ? album.trackRefs : undefined,
      artistPubkeys: album.artistPubkeys.length > 0 ? album.artistPubkeys : undefined,
      featuredArtists: newCollaborators.length > 0 ? newCollaborators : undefined,
      hashtags: album.hashtags.length > 0 ? album.hashtags : undefined,
      projectType: album.projectType,
      visibility: album.visibility,
    };

    // For private albums, re-encrypt with updated collaborator list
    const unsigned = album.visibility === "private"
      ? await buildPrivateAlbumEvent(pubkey, { ...albumParams, collaborators: newCollaborators })
      : buildAlbumEvent(pubkey, albumParams);

    await signAndPublish(unsigned);
    // No manual dispatch needed — signAndPublish → processIncomingEvent handles it
  };

  const handleAddCollaborator = async (pk: string) => {
    if (pk === album.pubkey || collaborators.includes(pk)) return;
    await republishAlbum([...collaborators, pk]);
  };

  const handleRemoveCollaborator = async (pk: string) => {
    await republishAlbum(collaborators.filter((c) => c !== pk));
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main content */}
      <div className={`flex-1 overflow-y-auto ${scrollPaddingClass}`}>
        {/* Header */}
        <div className="flex items-end gap-6 bg-linear-to-b from-card-hover/30 to-transparent p-6">
          <button
            onClick={() => dispatch(goBack())}
            className="self-start rounded p-1 text-soft hover:text-heading"
          >
            <ArrowLeft size={20} />
          </button>
          {album.imageUrl ? (
            <img
              src={album.imageUrl}
              alt={album.title}
              className="h-36 w-36 rounded-lg object-cover shadow-lg"
            />
          ) : (
            <div className="flex h-36 w-36 items-center justify-center rounded-lg bg-card">
              <Disc3 size={48} className="text-muted" />
            </div>
          )}
          <div>
            <p className="text-xs uppercase tracking-wider text-soft">{album.projectType === "album" ? "Album" : album.projectType}</p>
            <h1 className="text-2xl font-bold text-heading">{album.title}</h1>
            <p className="text-sm text-soft">
              {(() => {
                const target = resolveArtistDetailTarget(album.artist, album.artistPubkeys);
                if (!target) return <span>{resolvedArtist}</span>;
                return (
                  <button
                    type="button"
                    onClick={() => dispatch(setActiveDetailId(target))}
                    className="hover:text-heading hover:underline"
                  >
                    {resolvedArtist}
                  </button>
                );
              })()}
              {" "}&middot; {album.trackCount} track
              {album.trackCount !== 1 ? "s" : ""}
              {collaborators.length > 0 && (
                <> &middot; {collaborators.length} collaborator{collaborators.length !== 1 ? "s" : ""}</>
              )}
            </p>
            {(album.genre || album.hashtags.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {album.genre && (
                  <span className="rounded-full bg-card px-2 py-0.5 text-xs text-soft">
                    {album.genre}
                  </span>
                )}
                {album.hashtags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-card px-2 py-0.5 text-xs text-muted"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => playQueue(queueIds, 0)}
                disabled={queueIds.length === 0}
                className="flex items-center gap-1.5 rounded-full bg-linear-to-r from-primary to-primary-soft px-4 py-1.5 text-sm font-medium text-white transition-transform hover:scale-105 press-effect disabled:opacity-50"
              >
                <Play size={14} fill="currentColor" />
                Play All
              </button>
              <button
                onClick={() => {
                  const shuffled = [...queueIds].sort(() => Math.random() - 0.5);
                  playQueue(shuffled, 0);
                }}
                disabled={queueIds.length === 0}
                className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading disabled:opacity-50"
              >
                <Shuffle size={14} />
                Shuffle
              </button>
              {album.visibility !== "local" && (
                <button
                  onClick={async () => {
                    const link = buildMusicLink(album.addressableId);
                    const ok = await copyToClipboard(link);
                    if (ok) {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
                >
                  <Link2 size={14} />
                  {copied ? "Copied!" : "Copy Link"}
                </button>
              )}
              {pubkey !== album.pubkey && album.visibility !== "local" && (
                <>
                  {confirmRemove ? (
                    <button
                      onClick={() => {
                        unsaveAlbum(album.addressableId);
                        setConfirmRemove(false);
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-4 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20"
                    >
                      <Trash2 size={14} />
                      Confirm Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (isAlbumSaved(album.addressableId)) {
                          setConfirmRemove(true);
                        } else {
                          saveAlbum(album.addressableId);
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
                    >
                      {isAlbumSaved(album.addressableId) ? (
                        <Check size={14} className="text-green-400" />
                      ) : (
                        <Plus size={14} />
                      )}
                      {isAlbumSaved(album.addressableId) ? "In Library" : "Add to Library"}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (isAlbumFavorited(album.addressableId)) {
                        unfavoriteAlbum(album.addressableId);
                      } else {
                        favoriteAlbum(album.addressableId);
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
                  >
                    <Heart
                      size={14}
                      className={isAlbumFavorited(album.addressableId) ? "fill-red-500 text-red-500" : ""}
                    />
                    {isAlbumFavorited(album.addressableId) ? "Favorited" : "Favorite"}
                  </button>
                </>
              )}
              {(isOwner || isCollaborator) && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
                >
                  <Pencil size={14} />
                  Edit Project
                </button>
              )}
              {(isOwner || isCollaborator) && (
                <button
                  onClick={() => setShowMembers((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm transition-colors ${
                    showMembers
                      ? "border-primary/40 text-heading"
                      : "border-border text-soft hover:border-border-light hover:text-heading"
                  }`}
                >
                  <Users size={14} />
                  Members
                </button>
              )}
              {(isOwner || isCollaborator) && (
                <button
                  onClick={() =>
                    dispatch(
                      setActiveDetailId({
                        view: "project-history",
                        id: album.addressableId,
                      }),
                    )
                  }
                  className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
                >
                  <Clock size={14} />
                  History
                </button>
              )}
              {/* TODO: Re-enable proposals/changes system later */}
            </div>
          </div>
        </div>

        {/* Update Available banner */}
        {hasUpdate && !isOwner && (
          <div className="mx-6 mt-2 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <RefreshCw size={16} className="shrink-0 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium text-heading">Update Available</p>
              <p className="text-xs text-soft">
                The artist has released a new version of this project.
              </p>
            </div>
            <button
              onClick={() => setShowReleaseNotes(true)}
              className="shrink-0 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/30 transition-colors"
            >
              View Details
            </button>
          </div>
        )}

        {/* Track list */}
        <div className="px-6 py-4">
          {albumTracks.length > 0 ? (
            albumTracks.map((track, i) => (
              <TrackRow
                key={track.addressableId}
                track={track}
                index={i}
                queueTracks={queueIds}
              />
            ))
          ) : (
            <p className="text-sm text-soft">No tracks in this album yet</p>
          )}
          {unsavedTrackCount > 0 && (
            <button
              onClick={() => {
                for (const t of allAlbumTracks) {
                  if (!savedTrackIds.includes(t.addressableId)) {
                    saveTrack(t.addressableId);
                  }
                }
              }}
              className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-soft transition-colors hover:border-border-light hover:text-heading"
            >
              <Plus size={14} />
              Add {unsavedTrackCount} remaining track{unsavedTrackCount !== 1 ? "s" : ""}
            </button>
          )}

          {/* Notes */}
          {albumId && (
            <AnnotationsPanel
              targetRef={albumId}
              targetName={album.title}
              ownerPubkey={album.pubkey}
              albumTracks={allAlbumTracks.map((t) => ({
                addressableId: t.addressableId,
                title: t.title,
                pubkey: t.pubkey,
              }))}
            />
          )}
        </div>
      </div>

      {/* Collaborators side panel */}
      {showReleaseNotes && albumId && (
        <ReleaseNotesModal
          albumId={albumId}
          onClose={() => setShowReleaseNotes(false)}
          onUpdate={() => {
            if (album) {
              acknowledgeUpdate(album.addressableId, album.eventId, album.createdAt);
            }
            setShowReleaseNotes(false);
          }}
        />
      )}

      {editOpen && (
        <CreateAlbumModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          album={album}
        />
      )}

      {showMembers && (
        <div className="flex w-64 shrink-0 flex-col border-l border-border">
          <div className="flex h-12 items-center border-b border-border px-4">
            <Users size={16} className="mr-2 text-soft" />
            <span className="text-sm font-semibold text-body">Members</span>
            <button
              onClick={() => setShowMembers(false)}
              className="ml-auto rounded p-0.5 text-muted hover:text-heading"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {/* Owner */}
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Owner
            </div>
            <CollaboratorRow pubkey={album.pubkey} isOwner={false} />

            {/* Collaborators list */}
            {collaborators.length > 0 && (
              <>
                <div className="mb-1 mt-3 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Collaborators ({collaborators.length})
                </div>
                {collaborators.map((pk) => (
                  <CollaboratorRow
                    key={pk}
                    pubkey={pk}
                    isOwner={isOwner}
                    onRemove={() => handleRemoveCollaborator(pk)}
                  />
                ))}
              </>
            )}

            {collaborators.length === 0 && (
              <div className="mt-3 px-2 py-3 text-center text-xs text-muted">
                No collaborators yet
              </div>
            )}

            {/* Add collaborator (owner only) */}
            {isOwner && (
              <AddCollaboratorSearch
                ownerPubkey={album.pubkey}
                existingCollaborators={collaborators}
                onAdd={handleAddCollaborator}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Inline search-based collaborator adder ── */
function AddCollaboratorSearch({
  ownerPubkey,
  existingCollaborators,
  onAdd,
}: {
  ownerPubkey: string;
  existingCollaborators: string[];
  onAdd: (pubkey: string) => void;
}) {
  const { query, setQuery, results, isSearching } = useUserSearch();
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const excluded = new Set([ownerPubkey, ...existingCollaborators]);
  const filteredResults = results.filter((r) => !excluded.has(r.pubkey));
  const showDropdown = focused && query.trim().length > 0 && (filteredResults.length > 0 || isSearching);

  const handleSelect = (pubkey: string) => {
    onAdd(pubkey);
    setQuery("");
    setFocused(false);
  };

  return (
    <div ref={containerRef} className="mt-3 border-t border-border pt-3 px-1">
      <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <UserPlus size={10} />
        Add Collaborator
      </div>
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-field px-3 py-1.5 focus-within:border-primary/40 transition-colors">
          <Search size={12} className="text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            placeholder="Search by name or npub..."
            className="flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted hover:text-heading"
            >
              <X size={10} />
            </button>
          )}
        </div>
        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border-light bg-panel shadow-xl shadow-black/40">
            {isSearching && filteredResults.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted">Searching...</p>
            )}
            {filteredResults.map((r) => {
              const name = r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8) + "...";
              const secondary = r.profile.nip05 || r.pubkey.slice(0, 12) + "...";
              return (
                <button
                  key={r.pubkey}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(r.pubkey)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-card-hover/30"
                >
                  <Avatar src={r.profile.picture} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-heading">{name}</p>
                    <p className="truncate text-xs text-muted">{secondary}</p>
                  </div>
                </button>
              );
            })}
            {isSearching && filteredResults.length > 0 && (
              <p className="px-3 py-1.5 text-center text-[10px] text-muted">Searching for more...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
