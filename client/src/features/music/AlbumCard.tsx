import { memo, useRef, useState } from "react";
import { Disc3, MoreHorizontal, Pencil, Link2, Heart, Plus, Check, Trash2, ListPlus, Send, Globe, Play } from "lucide-react";
import type { MusicAlbum } from "@/types/music";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveDetailId, addToQueue } from "@/store/slices/musicSlice";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
import { CreateAlbumModal } from "./CreateAlbumModal";
import { useLibrary } from "./useLibrary";
import { useAudioPlayer } from "./useAudioPlayer";
import { useDeleteMusic } from "./useDeleteMusic";
import { buildMusicLink } from "./musicLinks";
import { copyToClipboard } from "@/lib/clipboard";
import { UpdateAvailableBadge } from "./UpdateAvailableBadge";
import { RecipientPickerModal } from "@/components/sharing/RecipientPickerModal";
import { SpacePickerModal } from "@/components/sharing/SpacePickerModal";
import { sendDM } from "@/features/dm/dmService";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import { signAndPublish, publishExisting } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { indexSpaceFeed } from "@/store/slices/eventsSlice";
import { trackFeedTimestamp } from "@/store/slices/feedSlice";
import { store } from "@/store";
import { buildChatMessage } from "@/lib/nostr/eventBuilder";
import type { UnsignedEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";

interface AlbumCardProps {
  album: MusicAlbum;
  onNavigate?: () => void;
}

export const AlbumCard = memo(function AlbumCard({ album, onNavigate }: AlbumCardProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const isOwner = pubkey === album.pubkey;
  const isLocal = album.visibility === "local";
  const { saveAlbum, unsaveAlbum, isAlbumSaved, favoriteAlbum, unfavoriteAlbum, isAlbumFavorited } = useLibrary();
  const saved = isAlbumSaved(album.addressableId);
  const favorited = isAlbumFavorited(album.addressableId);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { deleteAlbum, deleting } = useDeleteMusic();
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const hasUpdate = useAppSelector(
    (s) => s.music.savedVersions[album.addressableId]?.hasUpdate ?? false,
  );

  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) => s.music.tracksByAlbum[album.addressableId]);
  const { playQueue } = useAudioPlayer();

  const handlePlayAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const refs = album.trackRefs.length > 0
      ? album.trackRefs
      : tracksByAlbum ?? [];
    const queueIds = refs.filter((id) => tracks[id]);
    if (queueIds.length > 0) playQueue(queueIds, 0);
  };

  const handleAddToQueue = () => {
    setMenuOpen(false);
    const trackRefs = album.trackRefs.length > 0
      ? album.trackRefs
      : tracksByAlbum ?? [];
    for (const trackRef of trackRefs) {
      dispatch(addToQueue(trackRef));
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          if (onNavigate) {
            onNavigate();
          } else {
            dispatch(
              setActiveDetailId({ view: "album-detail", id: album.addressableId }),
            );
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (onNavigate) {
              onNavigate();
            } else {
              dispatch(
                setActiveDetailId({ view: "album-detail", id: album.addressableId }),
              );
            }
          }
        }}
        className="group relative flex w-full cursor-pointer flex-col rounded-xl border border-edge card-glass transition-all hover:border-edge-light hover-lift"
      >
        <div className="relative aspect-square w-full overflow-hidden rounded-t-xl">
          {hasUpdate && (
            <div className="absolute left-2 top-2 z-10">
              <UpdateAvailableBadge />
            </div>
          )}
          {album.imageUrl ? (
            <img
              src={album.imageUrl}
              alt={album.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-card">
              <Disc3 size={32} className="text-muted" />
            </div>
          )}
          {/* Play All button */}
          <div
            role="button"
            tabIndex={0}
            onClick={handlePlayAll}
            onKeyDown={(e) => { if (e.key === "Enter") handlePlayAll(e as unknown as React.MouseEvent); }}
            className="absolute bottom-2 right-2 z-10 translate-y-2 scale-90 rounded-full bg-gradient-to-br from-pulse to-pulse-soft p-2 text-white opacity-0 shadow-lg transition-all duration-200 group-hover:translate-y-0 group-hover:scale-100 group-hover:opacity-100 hover:scale-110 press-effect"
            title="Play All"
          >
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </div>
        </div>
        {(isOwner || !isLocal) && (
          <div className="absolute right-1 top-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="relative">
              <button
                ref={menuBtnRef}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="rounded-full bg-backdrop/70 p-1 text-soft hover:text-heading"
              >
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <PopoverMenu open={menuOpen} onClose={() => { setMenuOpen(false); setConfirmRemove(false); }} position="below" anchorRef={menuBtnRef}>
                  {/* Add to Queue (all tracks) */}
                  {(album.trackRefs.length > 0 || (tracksByAlbum && tracksByAlbum.length > 0)) && (
                    <PopoverMenuItem
                      icon={<ListPlus size={14} />}
                      label="Add to Queue"
                      onClick={handleAddToQueue}
                    />
                  )}
                  {!isOwner && !isLocal && (
                    <>
                      {saved && confirmRemove ? (
                        <PopoverMenuItem
                          icon={<Trash2 size={14} />}
                          label="Confirm Remove"
                          variant="danger"
                          onClick={() => {
                            setMenuOpen(false);
                            setConfirmRemove(false);
                            unsaveAlbum(album.addressableId);
                          }}
                        />
                      ) : (
                        <PopoverMenuItem
                          icon={saved ? <Check size={14} className="text-green-400" /> : <Plus size={14} />}
                          label={saved ? "Remove from Library" : "Add to Library"}
                          onClick={() => {
                            if (saved) {
                              setConfirmRemove(true);
                            } else {
                              setMenuOpen(false);
                              saveAlbum(album.addressableId);
                            }
                          }}
                        />
                      )}
                      <PopoverMenuItem
                        icon={<Heart size={14} className={favorited ? "fill-red-500 text-red-500" : ""} />}
                        label={favorited ? "Remove from Favorites" : "Add to Favorites"}
                        onClick={() => {
                          setMenuOpen(false);
                          if (favorited) unfavoriteAlbum(album.addressableId);
                          else favoriteAlbum(album.addressableId);
                        }}
                      />
                    </>
                  )}
                  {!isLocal && (
                    <PopoverMenuItem
                      icon={<Link2 size={14} />}
                      label="Copy Link"
                      onClick={() => {
                        setMenuOpen(false);
                        copyToClipboard(buildMusicLink(album.addressableId));
                      }}
                    />
                  )}
                  {!isLocal && (
                    <PopoverMenuItem
                      icon={<Send size={14} />}
                      label="Send to DM"
                      onClick={() => {
                        setMenuOpen(false);
                        setDmPickerOpen(true);
                      }}
                    />
                  )}
                  {!isLocal && (
                    <PopoverMenuItem
                      icon={<Globe size={14} />}
                      label="Share to Space"
                      onClick={() => {
                        setMenuOpen(false);
                        setSpacePickerOpen(true);
                      }}
                    />
                  )}
                  {isOwner && (
                    <>
                      {!isLocal && <PopoverMenuSeparator />}
                      <PopoverMenuItem
                        icon={<Pencil size={14} />}
                        label="Edit Project"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditOpen(true);
                        }}
                      />
                      <PopoverMenuSeparator />
                      {confirmDelete ? (
                        <>
                          <PopoverMenuItem
                            icon={<Trash2 size={14} />}
                            label={deleting ? "Deleting..." : "Project Only"}
                            variant="danger"
                            onClick={async () => {
                              setMenuOpen(false);
                              setConfirmDelete(false);
                              await deleteAlbum(album, false);
                            }}
                          />
                          <PopoverMenuItem
                            icon={<Trash2 size={14} />}
                            label={deleting ? "Deleting..." : "Project + All Tracks"}
                            variant="danger"
                            onClick={async () => {
                              setMenuOpen(false);
                              setConfirmDelete(false);
                              await deleteAlbum(album, true);
                            }}
                          />
                        </>
                      ) : (
                        <PopoverMenuItem
                          icon={<Trash2 size={14} />}
                          label="Delete Project"
                          variant="danger"
                          onClick={() => setConfirmDelete(true)}
                        />
                      )}
                    </>
                  )}
                </PopoverMenu>
              )}
            </div>
          </div>
        )}
        <div className="p-2">
          <p className="truncate text-sm font-medium text-heading">{album.title}</p>
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs text-soft">{album.artist}</p>
            {album.projectType !== "album" && (
              <span className="shrink-0 rounded bg-card-hover/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                {album.projectType}
              </span>
            )}
          </div>
        </div>
      </div>
      {editOpen && (
        <CreateAlbumModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          album={album}
        />
      )}
      {dmPickerOpen && (
        <RecipientPickerModal
          open={dmPickerOpen}
          onClose={() => setDmPickerOpen(false)}
          onSelect={async (recipientPubkey) => {
            const content = buildNaddrReference(album.addressableId);
            await sendDM(recipientPubkey, content);
          }}
        />
      )}
      {spacePickerOpen && (
        <SpacePickerModal
          open={spacePickerOpen}
          onClose={() => setSpacePickerOpen(false)}
          channelTypes={["chat", "notes", "music"]}
          onSelect={async (space: Space, channel: SpaceChannel) => {
            if (!pubkey) return;
            const originalEvent = store.getState().events.entities[album.eventId];
            if (!originalEvent) return;

            // Best-effort relay connection
            relayManager.connect(space.hostRelay, "read+write");
            try {
              await relayManager.waitForConnection(space.hostRelay, 5000);
            } catch {
              // Continue anyway
            }

            if (channel.type === "music") {
              // Direct music share: republish original album event
              await publishExisting(originalEvent, [space.hostRelay]);
              const contextId = `${space.id}:${channel.id}`;
              dispatch(indexSpaceFeed({ contextId, eventId: album.eventId }));
              dispatch(trackFeedTimestamp({ contextId, createdAt: originalEvent.created_at }));
              dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: album.eventId }));
              dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: originalEvent.created_at }));
            } else {
              // Share as a message with a nostr:naddr embed
              const naddr = buildNaddrReference(album.addressableId);

              if (channel.type === "chat") {
                const unsigned = buildChatMessage(pubkey, space.id, naddr, undefined, channel.id);
                await signAndPublish(unsigned, [space.hostRelay]);
              } else {
                const unsigned: UnsignedEvent = {
                  pubkey,
                  created_at: Math.floor(Date.now() / 1000),
                  kind: 1,
                  tags: [],
                  content: naddr,
                };
                await signAndPublish(unsigned, [space.hostRelay]);
              }

              // Also republish album event so it appears in #music
              await publishExisting(originalEvent, [space.hostRelay]);

              const allChannels = store.getState().spaces.channels[space.id] ?? [];
              const musicCh = allChannels.find((c) => c.type === "music");
              if (musicCh) {
                dispatch(indexSpaceFeed({ contextId: `${space.id}:${musicCh.id}`, eventId: album.eventId }));
                dispatch(trackFeedTimestamp({ contextId: `${space.id}:${musicCh.id}`, createdAt: originalEvent.created_at }));
              }
              dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: album.eventId }));
              dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: originalEvent.created_at }));
            }
          }}
        />
      )}
    </>
  );
});
