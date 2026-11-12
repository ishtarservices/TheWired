import { useMemo, useState, useRef, useEffect } from "react";
import { ArrowLeft, Play, Shuffle, Link2, Heart, Plus, Check, Trash2, Users, UserPlus, X, Clock, RefreshCw, Pencil, Search, KeyRound } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { signerForRelease, useHoldsProjectKey, useIsMine } from "../sharedKey/ownership";
import { isSharedRelease } from "../sharedKey/members";
import { albumParamsFrom } from "../sharedKey/releaseEdit";
import { addProjectOwner } from "../sharedKey/projectOwners";
import type { MusicMember } from "@/types/music";
import { goBack, setActiveDetailId } from "@/store/slices/musicSlice";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";
import { useLibrary } from "../useLibrary";
import { buildMusicLink } from "../musicLinks";
import { buildAlbumEvent, buildPrivateAlbumEvent } from "../musicEventBuilder";
import { spacePublishRelaysForAll } from "../spacePublish";
import { copyToClipboard } from "@/lib/clipboard";
import { signAndPublish } from "@/lib/nostr/publish";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "@/features/profile/useProfile";
import { useUserSearch } from "@/features/search/useUserSearch";
import { useSavedVersions, useHasPendingUpdate } from "../useSavedVersions";
import { ReleaseNotesModal } from "../ReleaseNotesModal";
import { CreateAlbumModal } from "../CreateAlbumModal";
import { AnnotationsPanel } from "../AnnotationsPanel";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { useResolvedArtist, resolveArtistDetailTarget } from "../useResolvedArtist";
import { ListenRequestsSection } from "../ListenRequestsSection";
import { Artwork } from "../Artwork";
import { resolveMusic } from "@/lib/api/music";
import { processIncomingEvent } from "@/lib/nostr/eventPipeline";

const ICON_BTN =
  "flex h-9 w-9 items-center justify-center rounded-full border border-border text-soft transition-colors hover:bg-surface-hover hover:text-heading disabled:opacity-40";
const TEXT_BTN =
  "flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-soft transition-colors hover:bg-surface-hover hover:text-heading";

/** "22 min" / "1 hr 4 min" for a project's total running time. */
function formatRuntime(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
}

function CollaboratorRow({
  pubkey,
  isOwner,
  onRemove,
  onShareKey,
  sharingKey = false,
}: {
  pubkey: string;
  isOwner: boolean;
  onRemove?: () => void;
  /** Share the shared project's key with this member (co-owner holders only). */
  onShareKey?: () => void;
  sharingKey?: boolean;
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
      {onShareKey && (
        <button
          onClick={onShareKey}
          disabled={sharingKey}
          className="shrink-0 rounded p-0.5 text-muted hover:text-heading transition-colors disabled:opacity-50"
          title="Share the project key (make co-owner)"
        >
          <KeyRound size={14} />
        </button>
      )}
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
  const isMine = useIsMine();
  // A shared project whose key this device holds (co-owner powers).
  const holdsKey = useHoldsProjectKey(album?.pubkey);
  const movedTo = useAppSelector((s) => (albumId ? s.music.movedReleases[albumId]?.to : undefined));
  const movedTarget = useAppSelector((s) => (movedTo ? s.music.albums[movedTo] : undefined));
  const [keyError, setKeyError] = useState<string | null>(null);
  const [sharingKeyWith, setSharingKeyWith] = useState<string | null>(null);
  const { playQueue } = useAudioPlayer();
  const { saveTrack, saveAlbum, unsaveAlbum, isAlbumSaved, favoriteAlbum, unfavoriteAlbum, isAlbumFavorited } = useLibrary();
  const { acknowledgeUpdate } = useSavedVersions();
  const hasUpdate = useHasPendingUpdate(albumId);
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
    isMine(album?.pubkey) ||
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

  const totalDuration = useMemo(
    () => albumTracks.reduce((sum, t) => sum + (t.duration && isFinite(t.duration) ? t.duration : 0), 0),
    [albumTracks],
  );

  // A project that reached the store without its tracks (browse and search
  // return the project event alone) lists track refs it can't show. Resolve it
  // once so the page isn't "7 tracks" over an empty list.
  const [loadingTracks, setLoadingTracks] = useState(false);
  const resolvedFor = useRef<string | null>(null);
  const missingTracks =
    !!album && album.trackRefs.length > 0 && album.trackRefs.some((id) => !tracks[id]);
  useEffect(() => {
    if (!album || !missingTracks || resolvedFor.current === album.addressableId) return;
    resolvedFor.current = album.addressableId;
    const [, authorPubkey, ...slugParts] = album.addressableId.split(":");
    const slug = slugParts.join(":");
    if (!authorPubkey || !slug) return;
    let cancelled = false;
    setLoadingTracks(true);
    resolveMusic("album", authorPubkey, slug)
      .catch((err) => {
        if (!pubkey) throw err;
        return resolveMusic("album", authorPubkey, slug, { auth: true });
      })
      .then(async (result) => {
        const data = result.data as { tracks?: unknown[] };
        for (const trackEvent of data.tracks ?? []) {
          await processIncomingEvent(trackEvent, "resolve");
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingTracks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [album, missingTracks, pubkey]);

  // A rotation stub replaced this project: follow it to its new address.
  useEffect(() => {
    if (!album && movedTo && movedTarget) {
      dispatch(setActiveDetailId({ view: "album-detail", id: movedTo }));
    }
  }, [album, movedTo, movedTarget, dispatch]);

  if (!album) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">
          {movedTo ? "This project moved. You may have been removed, or its new key is still on its way." : "Album not found"}
        </p>
      </div>
    );
  }

  const queueIds = albumTracks.map((t) => t.addressableId);
  const isOwner = isMine(album.pubkey);
  const isCollaborator = !!pubkey && (
    album.featuredArtists.includes(pubkey) || album.collaborators.includes(pubkey)
  );
  // All collaborator-type pubkeys for the members list
  const collaborators = [...new Set([...album.featuredArtists, ...album.collaborators])];

  // Shared-key holders (`owner` tags); a personal project's owner is its author.
  const owners = isSharedRelease(album) ? (album.owners ?? []) : [album.pubkey];
  const ownerTaggedWithoutKey = !!pubkey && !isOwner && (album.owners ?? []).includes(pubkey);

  const republishAlbum = async (newCollaborators: string[], members: MusicMember[] | undefined = album.members) => {
    if (!pubkey || !isOwner) return;
    // My project, or a shared one signed as its key.
    const author = await signerForRelease(album.pubkey);
    if (!author) return;
    const shared = !!author.signer || isSharedRelease(album);
    // Keep the space scope, export flag and every member; rebuilding without
    // them made a space project public, re-enabled export, or dropped owners.
    const albumParams = {
      ...albumParamsFrom(album),
      featuredArtists: newCollaborators.length > 0 ? newCollaborators : undefined,
      members,
    };

    // For private albums, re-encrypt with updated collaborator list. A shared
    // private project stays in the relay-gated form (no NIP-44 copies).
    const unsigned = album.visibility === "private" && !shared
      ? await buildPrivateAlbumEvent(author.pubkey, { ...albumParams, collaborators: newCollaborators })
      : buildAlbumEvent(author.pubkey, albumParams);

    const targetRelays =
      album.visibility === "space" ? await spacePublishRelaysForAll(album.spaceIds) : undefined;
    await signAndPublish(unsigned, targetRelays, { signer: author.signer });
    // No manual dispatch needed — signAndPublish → processIncomingEvent handles it
  };

  /** Make `pk` a co-owner: declare them with an `owner` tag on the project
   *  and every track its key signed, then send them the project key. */
  const handleShareKey = async (pk: string) => {
    if (!holdsKey || pk === pubkey) return;
    setKeyError(null);
    setSharingKeyWith(pk);
    try {
      await addProjectOwner(album, tracks, pk);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Couldn't share the key.");
    } finally {
      setSharingKeyWith(null);
    }
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
        <header className="relative isolate overflow-hidden">
          {/* The cover, blurred far out, tints the header. Colour in the music
              section comes from the artwork, not from the chrome. */}
          {album.imageUrl && (
            <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
              <img
                src={album.imageUrl}
                alt=""
                className="h-full w-full scale-150 object-cover opacity-30 blur-3xl saturate-150"
              />
              <div className="absolute inset-0 bg-linear-to-b from-background/20 via-background/70 to-background" />
            </div>
          )}
          <div className="px-8 pt-5">
            <button
              onClick={() => dispatch(goBack())}
              className="-ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
            >
              <ArrowLeft size={14} />
              Back
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-x-8 gap-y-5 px-8 pb-7 pt-5">
            <Artwork
              src={album.imageUrl}
              title={album.title}
              loading="eager"
              className="h-52 w-52 rounded-xl shadow-[var(--shadow-lg)]"
            />
            <div className="min-w-0 flex-1 basis-72">
              <p className="label-caps text-soft">
                {album.projectType === "album" ? "Album" : album.projectType}
                {holdsKey && <span className="ml-2 text-muted">· shared</span>}
              </p>
              <h1 className="mt-2.5 text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-heading">
                {album.title}
              </h1>
              <p className="mt-3 text-sm text-body">
                {(() => {
                  const target = resolveArtistDetailTarget(album.artist, album.artistPubkeys);
                  if (!target) return <span>{resolvedArtist}</span>;
                  return (
                    <button
                      type="button"
                      onClick={() => dispatch(setActiveDetailId(target))}
                      className="font-medium text-heading hover:underline"
                    >
                      {resolvedArtist}
                    </button>
                  );
                })()}
              </p>
              <p className="readout mt-1.5 text-[11px] uppercase tracking-wider text-muted">
                {album.trackCount} track{album.trackCount !== 1 ? "s" : ""}
                {totalDuration > 0 && <> · {formatRuntime(totalDuration)}</>}
                {album.genre && <> · {album.genre}</>}
                {collaborators.length > 0 && (
                  <> · {collaborators.length} collaborator{collaborators.length !== 1 ? "s" : ""}</>
                )}
              </p>
              {album.hashtags.length > 0 && (
                <p className="mt-1.5 flex flex-wrap gap-x-2.5 text-xs text-muted">
                  {album.hashtags.map((tag) => (
                    <span key={tag}>#{tag}</span>
                  ))}
                </p>
              )}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => playQueue(queueIds, 0)}
                  disabled={queueIds.length === 0}
                  className="flex h-9 items-center gap-2 rounded-full bg-heading pl-3.5 pr-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 press-effect disabled:opacity-40"
                >
                  <Play size={14} fill="currentColor" />
                  Play
                </button>
                <button
                  onClick={() => {
                    const shuffled = [...queueIds].sort(() => Math.random() - 0.5);
                    playQueue(shuffled, 0);
                  }}
                  disabled={queueIds.length === 0}
                  className={ICON_BTN}
                  title="Shuffle"
                  aria-label="Shuffle"
                >
                  <Shuffle size={15} />
                </button>
                {!isMine(album.pubkey) && album.visibility !== "local" && (
                  <>
                    {confirmRemove ? (
                      <button
                        onClick={() => {
                          unsaveAlbum(album.addressableId);
                          setConfirmRemove(false);
                        }}
                        className="flex h-9 items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3.5 text-[13px] text-red-400 transition-colors hover:bg-red-500/20"
                      >
                        <Trash2 size={14} />
                        Remove from library?
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
                        className={ICON_BTN}
                        title={isAlbumSaved(album.addressableId) ? "In your library" : "Add to library"}
                        aria-label={isAlbumSaved(album.addressableId) ? "In your library" : "Add to library"}
                      >
                        {isAlbumSaved(album.addressableId) ? (
                          <Check size={15} className="text-success" />
                        ) : (
                          <Plus size={15} />
                        )}
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
                      className={ICON_BTN}
                      title={isAlbumFavorited(album.addressableId) ? "Favorited" : "Favorite"}
                      aria-label={isAlbumFavorited(album.addressableId) ? "Favorited" : "Favorite"}
                    >
                      <Heart
                        size={15}
                        className={isAlbumFavorited(album.addressableId) ? "fill-red-500 text-red-500" : ""}
                      />
                    </button>
                  </>
                )}
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
                    className={ICON_BTN}
                    title={copied ? "Link copied" : "Copy link"}
                    aria-label={copied ? "Link copied" : "Copy link"}
                  >
                    {copied ? <Check size={15} className="text-success" /> : <Link2 size={15} />}
                  </button>
                )}
                {(isOwner || isCollaborator) && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
                {isOwner && (
                  <button onClick={() => setEditOpen(true)} className={TEXT_BTN}>
                    <Pencil size={14} />
                    Edit
                  </button>
                )}
                {(isOwner || isCollaborator) && (
                  <button
                    onClick={() => setShowMembers((v) => !v)}
                    className={`${TEXT_BTN} ${showMembers ? "bg-surface-hover text-heading" : ""}`}
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
                    className={TEXT_BTN}
                  >
                    <Clock size={14} />
                    History
                  </button>
                )}
                {/* TODO: Re-enable proposals/changes system later */}
              </div>
            </div>
          </div>
        </header>

        {/* Update Available banner — derived from saved vs newest known version */}
        {hasUpdate && !isOwner && (
          <div
            role="status"
            className="mx-8 mb-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
          >
            <RefreshCw size={16} className="shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-heading">Update Available</p>
              <p className="truncate text-xs text-soft">
                {album.revisionSummary?.trim()
                  ? album.revisionSummary
                  : "The artist has released a new version of this project."}
              </p>
            </div>
            <button
              onClick={() => setShowReleaseNotes(true)}
              className="shrink-0 rounded-lg bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/30 transition-colors"
            >
              View Details
            </button>
            <button
              onClick={() => acknowledgeUpdate(album.addressableId)}
              aria-label="Dismiss update"
              title="Dismiss — mark this version as seen"
              className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-surface hover:text-heading transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Listen requests for this project and its tracks (owner only) */}
        {isOwner && (
          <ListenRequestsSection targetRefs={[album.addressableId, ...album.trackRefs]} />
        )}

        {/* Track list */}
        <div className="px-5 pb-4">
          {albumTracks.length > 0 ? (
            <div className="border-t border-border-light pt-2">
              {albumTracks.map((track, i) => (
                <TrackRow
                  key={track.addressableId}
                  track={track}
                  index={i}
                  queueTracks={queueIds}
                  context="album"
                />
              ))}
            </div>
          ) : (
            <p className="border-t border-border-light px-3 pt-5 text-sm text-muted">
              {loadingTracks ? "Loading tracks…" : "No tracks in this project yet"}
            </p>
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
              className="ml-3 mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] text-soft transition-colors hover:bg-surface hover:text-heading"
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
            if (album) acknowledgeUpdate(album.addressableId);
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
            {/* Owner(s): a shared project lists its key holders (first = started it) */}
            <div className="mb-1 px-2 label-caps">
              {owners.length > 1 ? `Owners (${owners.length})` : "Owner"}
            </div>
            {owners.map((pk) => (
              <CollaboratorRow key={pk} pubkey={pk} isOwner={false} />
            ))}
            {ownerTaggedWithoutKey && (
              <p className="px-2 py-1 text-[11px] text-muted">
                You co-own this project, but its key isn&apos;t on this device.
              </p>
            )}

            {/* Collaborators list */}
            {collaborators.length > 0 && (
              <>
                <div className="mb-1 mt-3 px-2 label-caps">
                  Collaborators ({collaborators.length})
                </div>
                {collaborators.map((pk) => (
                  <CollaboratorRow
                    key={pk}
                    pubkey={pk}
                    isOwner={isOwner}
                    onRemove={() => handleRemoveCollaborator(pk)}
                    onShareKey={holdsKey && !owners.includes(pk) ? () => handleShareKey(pk) : undefined}
                    sharingKey={sharingKeyWith === pk}
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

            {/* Add a co-owner: shares the project key */}
            {holdsKey && (
              <AddCollaboratorSearch
                ownerPubkey={pubkey ?? album.pubkey}
                existingCollaborators={owners}
                onAdd={handleShareKey}
                label="Share the key (co-owner)"
                icon={KeyRound}
              />
            )}
            {keyError && <p className="px-2 py-1 text-[11px] text-red-400">{keyError}</p>}
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
  label = "Add Collaborator",
  icon: Icon = UserPlus,
}: {
  ownerPubkey: string;
  existingCollaborators: string[];
  onAdd: (pubkey: string) => void;
  label?: string;
  icon?: typeof UserPlus;
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
      <div className="mb-1.5 flex items-center gap-1 label-caps">
        <Icon size={10} />
        {label}
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
