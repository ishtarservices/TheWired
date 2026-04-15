import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  X, Disc3, Play, Shuffle, Heart, Plus, Check, Link2, Send, Globe,
  Pencil, Trash2, ListPlus, SkipForward, CheckCircle2, Music2,
  Repeat2, MessageSquare,
} from "lucide-react";
import type { MusicAlbum } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useLibrary } from "./useLibrary";
import { useDeleteMusic } from "./useDeleteMusic";
import { useAudioPlayer } from "./useAudioPlayer";
import { useProfileShowcase } from "@/features/profile/useProfileShowcase";
import { buildMusicLink } from "./musicLinks";
import { copyToClipboard } from "@/lib/clipboard";
import { addToQueue, insertNextInQueue } from "@/store/slices/musicSlice";
import { buildRepost } from "@/lib/nostr/eventBuilder";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import { buildChatMessage } from "@/lib/nostr/eventBuilder";
import { signAndPublish, publishExisting } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { indexSpaceFeed } from "@/store/slices/eventsSlice";
import { trackFeedTimestamp } from "@/store/slices/feedSlice";
import { store } from "@/store";
import { sendDM } from "@/features/dm/dmService";
import type { UnsignedEvent } from "@/types/nostr";
import type { Space, SpaceChannel } from "@/types/space";

import { NotesTab } from "./panel/NotesTab";
import { useResolvedArtist } from "./useResolvedArtist";
import { HistoryTab } from "./panel/HistoryTab";
import { RecipientPickerModal } from "@/components/sharing/RecipientPickerModal";
import { SpacePickerModal } from "@/components/sharing/SpacePickerModal";
import { MusicPostModal } from "./MusicPostModal";

// ── Shared UI primitives (same as ActionsTab) ──

function useFlash(duration = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), duration);
  }, [duration]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [on, trigger];
}

function ActionButton({
  icon, confirmedIcon, label, confirmedLabel, onClick,
  variant = "default", fullWidth, active, confirmed, disabled,
}: {
  icon: React.ReactNode; confirmedIcon?: React.ReactNode;
  label: string; confirmedLabel?: string;
  onClick: () => void; variant?: "default" | "danger";
  fullWidth?: boolean; active?: boolean; confirmed?: boolean; disabled?: boolean;
}) {
  const showConfirmed = confirmed && confirmedLabel;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-all duration-200 ${
        fullWidth ? "col-span-2" : ""
      } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${
        showConfirmed ? "bg-green-500/10 text-green-400"
        : variant === "danger" ? "text-red-400 hover:bg-red-500/10"
        : active ? "bg-primary/10 text-primary"
        : "text-body hover:bg-surface-hover hover:text-heading"
      }`}
    >
      <span className={`flex-none transition-transform duration-200 ${showConfirmed ? "scale-110" : ""}`}>
        {showConfirmed && confirmedIcon ? confirmedIcon : icon}
      </span>
      <span className="truncate">{showConfirmed ? confirmedLabel : label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="col-span-2 mt-1 first:mt-0 px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted/50">{children}</p>;
}

function SectionDivider() {
  return <div className="col-span-2 my-0.5 border-t border-border/30" />;
}

// ── Types ──

type TabId = "actions" | "notes" | "history";

interface AlbumActionPanelProps {
  album: MusicAlbum;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
}

// ── Component ──

export function AlbumActionPanel({ album, open, onClose, onEdit }: AlbumActionPanelProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const isOwner = pubkey === album.pubkey;
  const isCollaborator = !!pubkey && (
    album.featuredArtists.includes(pubkey) || album.collaborators.includes(pubkey)
  );
  const canManage = isOwner || isCollaborator;
  const isLocal = album.visibility === "local";
  const originalEvent = useAppSelector((s) => s.events.entities[album.eventId]);

  const annotationCount = useAppSelector((s) => {
    const anns = s.music.annotations[album.addressableId];
    if (!anns) return 0;
    return anns.filter((a) => !a.isPrivate || a.authorPubkey === pubkey).length;
  });

  const tracks = useAppSelector((s) => s.music.tracks);
  const tracksByAlbum = useAppSelector((s) => s.music.tracksByAlbum[album.addressableId]);
  const { playQueue } = useAudioPlayer();
  const { saveAlbum, unsaveAlbum, isAlbumSaved, favoriteAlbum, unfavoriteAlbum, isAlbumFavorited } = useLibrary();
  const { deleteAlbum, deleting } = useDeleteMusic();
  const { addItem: addShowcaseItem, removeItem: removeShowcaseItem, isInShowcase } = useProfileShowcase(pubkey ?? null);

  const resolvedArtist = useResolvedArtist(album.artist, album.artistPubkeys);
  const saved = isAlbumSaved(album.addressableId);
  const favorited = isAlbumFavorited(album.addressableId);
  const albumInShowcase = isInShowcase(album.addressableId);

  const [activeTab, setActiveTab] = useState<TabId>("actions");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [postModalOpen, setPostModalOpen] = useState(false);

  const [playNextFlash, triggerPlayNext] = useFlash();
  const [queueFlash, triggerQueue] = useFlash();
  const [linkFlash, triggerLink] = useFlash();
  const [dmSentFlash, triggerDmSent] = useFlash();
  const [spaceSharedFlash, triggerSpaceShared] = useFlash();
  const [showcaseFlash, triggerShowcase] = useFlash();
  const [repostFlash, triggerRepost] = useFlash();

  const anyModalOpen = dmPickerOpen || spacePickerOpen || postModalOpen;

  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, anyModalOpen]);

  useEffect(() => {
    if (open) { setActiveTab("actions"); setConfirmDelete(false); }
  }, [open]);

  const getTrackRefs = () => album.trackRefs.length > 0 ? album.trackRefs : tracksByAlbum ?? [];

  const handlePlayAll = () => {
    const queueIds = getTrackRefs().filter((id) => tracks[id]);
    if (queueIds.length > 0) playQueue(queueIds, 0);
    onClose();
  };

  const handleShuffle = () => {
    const queueIds = getTrackRefs().filter((id) => tracks[id]);
    if (queueIds.length > 0) {
      const shuffled = [...queueIds].sort(() => Math.random() - 0.5);
      playQueue(shuffled, 0);
    }
    onClose();
  };

  const handlePlayNext = () => {
    const refs = getTrackRefs().filter((id) => tracks[id]);
    for (let i = refs.length - 1; i >= 0; i--) dispatch(insertNextInQueue(refs[i]));
    triggerPlayNext();
  };

  const handleAddToQueue = () => {
    for (const ref of getTrackRefs()) dispatch(addToQueue(ref));
    triggerQueue();
  };

  const handleCopyLink = () => {
    copyToClipboard(buildMusicLink(album.addressableId));
    triggerLink();
  };

  const handleSendToDM = async (recipientPubkey: string) => {
    const content = buildNaddrReference(album.addressableId);
    await sendDM(recipientPubkey, content);
    triggerDmSent();
  };

  const handleShareToSpace = async (space: Space, channel: SpaceChannel) => {
    if (!pubkey) return;
    const evt = store.getState().events.entities[album.eventId];
    if (!evt) return;

    relayManager.connect(space.hostRelay, "read+write");
    try { await relayManager.waitForConnection(space.hostRelay, 5000); } catch { /* ok */ }

    if (channel.type === "music") {
      await publishExisting(evt, [space.hostRelay]);
      const contextId = `${space.id}:${channel.id}`;
      dispatch(indexSpaceFeed({ contextId, eventId: album.eventId }));
      dispatch(trackFeedTimestamp({ contextId, createdAt: evt.created_at }));
      dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: album.eventId }));
      dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: evt.created_at }));
    } else {
      const naddr = buildNaddrReference(album.addressableId);
      if (channel.type === "chat") {
        const unsigned = buildChatMessage(pubkey, space.id, naddr, undefined, channel.id);
        await signAndPublish(unsigned, [space.hostRelay]);
      } else {
        const unsigned: UnsignedEvent = { pubkey, created_at: Math.floor(Date.now() / 1000), kind: 1, tags: [], content: naddr };
        await signAndPublish(unsigned, [space.hostRelay]);
      }
      await publishExisting(evt, [space.hostRelay]);
      // Also index into "all" mode music channels (curated channels require explicit sharing)
      const allChannels = store.getState().spaces.channels[space.id] ?? [];
      const allModeMusic = allChannels.filter((c) => c.type === "music" && c.feedMode !== "curated");
      for (const musicCh of allModeMusic) {
        dispatch(indexSpaceFeed({ contextId: `${space.id}:${musicCh.id}`, eventId: album.eventId }));
        dispatch(trackFeedTimestamp({ contextId: `${space.id}:${musicCh.id}`, createdAt: evt.created_at }));
      }
      dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: album.eventId }));
      dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: evt.created_at }));
    }
    triggerSpaceShared();
  };

  const handleRepost = async () => {
    if (!pubkey || !originalEvent) return;
    try {
      const unsigned = buildRepost(pubkey, { id: originalEvent.id, pubkey: originalEvent.pubkey }, JSON.stringify(originalEvent));
      await signAndPublish(unsigned);
      triggerRepost();
    } catch { /* ok */ }
  };

  const handleShowcaseToggle = async () => {
    if (albumInShowcase) await removeShowcaseItem(album.addressableId);
    else await addShowcaseItem({ type: "album", addressableId: album.addressableId });
    triggerShowcase();
  };

  const handleDelete = async (withTracks: boolean) => {
    onClose();
    setConfirmDelete(false);
    await deleteAlbum(album, withTracks);
  };

  const confirmIcon = <CheckCircle2 size={14} />;
  const hasTracks = getTrackRefs().length > 0;

  const tabs: { id: TabId; label: string; badge?: number; show: boolean }[] = [
    { id: "actions", label: "Actions", show: true },
    { id: "notes", label: "Notes", badge: annotationCount > 0 ? annotationCount : undefined, show: true },
    { id: "history", label: "History", show: canManage },
  ];
  const visibleTabs = tabs.filter((t) => t.show);

  const panelContent = (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={(e) => { e.stopPropagation(); if (!anyModalOpen) onClose(); }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", duration: 0.25, bounce: 0.1 }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-[480px] max-h-[80vh] flex-col rounded-2xl border border-border/60 card-glass shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
              <div className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-surface">
                {album.imageUrl ? (
                  <img src={album.imageUrl} alt={album.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Disc3 size={16} className="text-muted" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-heading">{album.title}</p>
                <p className="truncate text-xs text-soft">
                  {resolvedArtist}
                  {album.projectType !== "album" && (
                    <span className="ml-1.5 rounded bg-card-hover/50 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted">
                      {album.projectType}
                    </span>
                  )}
                </p>
              </div>
              <button onClick={onClose} className="flex-none rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-heading">
                <X size={16} />
              </button>
            </div>

            {/* Tab bar */}
            <div className="flex border-b border-border/40 px-2">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === tab.id ? "text-heading" : "text-muted hover:text-soft"
                  }`}
                >
                  {tab.label}
                  {tab.badge !== undefined && (
                    <span className="ml-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                      {tab.badge}
                    </span>
                  )}
                  {activeTab === tab.id && (
                    <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto">
              {activeTab === "actions" && (
                <div className="grid grid-cols-2 px-3 py-2">
                  {/* ── Play ── */}
                  <SectionLabel>Play</SectionLabel>
                  {hasTracks && (
                    <>
                      <ActionButton icon={<Play size={14} />} label="Play All" onClick={handlePlayAll} />
                      <ActionButton icon={<Shuffle size={14} />} label="Shuffle" onClick={handleShuffle} />
                      <ActionButton
                        icon={<SkipForward size={14} />} confirmedIcon={confirmIcon}
                        label="Play Next" confirmedLabel="Playing Next!" confirmed={playNextFlash}
                        onClick={handlePlayNext}
                      />
                      <ActionButton
                        icon={<ListPlus size={14} />} confirmedIcon={confirmIcon}
                        label="Add to Queue" confirmedLabel="Queued!" confirmed={queueFlash}
                        onClick={handleAddToQueue}
                      />
                    </>
                  )}

                  {/* ── Library ── */}
                  {!isOwner && !isLocal && (
                    <>
                      <SectionDivider />
                      <SectionLabel>Library</SectionLabel>
                      <ActionButton
                        icon={saved ? <Check size={14} className="text-green-400" /> : <Plus size={14} />}
                        label={saved ? "Saved" : "Save to Library"}
                        onClick={() => { if (saved) unsaveAlbum(album.addressableId); else saveAlbum(album.addressableId); }}
                        active={saved}
                      />
                      <ActionButton
                        icon={<Heart size={14} className={favorited ? "fill-red-500 text-red-500" : ""} />}
                        label={favorited ? "Favorited" : "Favorite"}
                        onClick={() => { if (favorited) unfavoriteAlbum(album.addressableId); else favoriteAlbum(album.addressableId); }}
                        active={favorited}
                      />
                    </>
                  )}

                  {/* ── Share ── */}
                  {!isLocal && (
                    <>
                      <SectionDivider />
                      <SectionLabel>Share</SectionLabel>
                      <ActionButton
                        icon={<Link2 size={14} />} confirmedIcon={<Check size={14} />}
                        label="Copy Link" confirmedLabel="Copied!" confirmed={linkFlash}
                        onClick={handleCopyLink}
                      />
                      <ActionButton
                        icon={<Send size={14} />} confirmedIcon={confirmIcon}
                        label="Send to DM" confirmedLabel="Sent!" confirmed={dmSentFlash}
                        onClick={() => setDmPickerOpen(true)}
                      />
                      <ActionButton
                        icon={<Globe size={14} />} confirmedIcon={confirmIcon}
                        label="Share to Space" confirmedLabel="Shared!" confirmed={spaceSharedFlash}
                        onClick={() => setSpacePickerOpen(true)}
                      />
                      {originalEvent && (
                        <ActionButton
                          icon={<Repeat2 size={14} />} confirmedIcon={confirmIcon}
                          label="Repost" confirmedLabel="Reposted!" confirmed={repostFlash}
                          onClick={handleRepost}
                        />
                      )}
                      <ActionButton
                        icon={<MessageSquare size={14} />}
                        label="Post with Note"
                        onClick={() => setPostModalOpen(true)}
                      />
                    </>
                  )}

                  {/* ── Profile ── */}
                  {pubkey && !isLocal && (
                    <>
                      <SectionDivider />
                      <SectionLabel>Profile</SectionLabel>
                      <ActionButton
                        icon={<Music2 size={14} className={albumInShowcase ? "text-primary" : ""} />}
                        confirmedIcon={confirmIcon}
                        label={albumInShowcase ? "In Profile Library" : "Add to Profile Library"}
                        confirmedLabel={albumInShowcase ? "Removed!" : "Added!"}
                        confirmed={showcaseFlash}
                        onClick={handleShowcaseToggle}
                        active={albumInShowcase}
                      />
                    </>
                  )}

                  {/* ── Manage (owner or collaborator) ── */}
                  {canManage && (
                    <>
                      <SectionDivider />
                      <SectionLabel>Manage</SectionLabel>
                      <ActionButton icon={<Pencil size={14} />} label="Edit Project" onClick={() => { onClose(); onEdit(); }} />
                    </>
                  )}

                  {/* ── Danger (owner) ── */}
                  {isOwner && (
                    <>
                      <SectionDivider />
                      {confirmDelete ? (
                        <>
                          <ActionButton
                            icon={<Trash2 size={14} />}
                            label={deleting ? "Deleting..." : "Project Only"}
                            variant="danger"
                            onClick={() => handleDelete(false)}
                            disabled={deleting}
                          />
                          <ActionButton
                            icon={<Trash2 size={14} />}
                            label={deleting ? "Deleting..." : "Project + All Tracks"}
                            variant="danger"
                            onClick={() => handleDelete(true)}
                            disabled={deleting}
                          />
                        </>
                      ) : (
                        <ActionButton
                          icon={<Trash2 size={14} />}
                          label="Delete Project"
                          variant="danger"
                          fullWidth
                          onClick={() => setConfirmDelete(true)}
                        />
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === "notes" && (
                <NotesTab
                  targetRef={album.addressableId}
                  targetName={album.title}
                  ownerPubkey={album.pubkey}
                />
              )}

              {activeTab === "history" && canManage && (
                <HistoryTab addressableId={album.addressableId} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {createPortal(panelContent, document.body)}

      {dmPickerOpen && (
        <RecipientPickerModal
          open={dmPickerOpen}
          onClose={() => setDmPickerOpen(false)}
          onBack={() => setDmPickerOpen(false)}
          onSelect={handleSendToDM}
        />
      )}
      {spacePickerOpen && (
        <SpacePickerModal
          open={spacePickerOpen}
          onClose={() => setSpacePickerOpen(false)}
          onBack={() => setSpacePickerOpen(false)}
          onSelect={handleShareToSpace}
          channelTypes={["chat", "notes", "music"]}
        />
      )}
      {postModalOpen && (
        <MusicPostModal
          open={postModalOpen}
          onClose={() => setPostModalOpen(false)}
          target={{
            addressableId: album.addressableId,
            eventId: album.eventId,
            pubkey: album.pubkey,
            title: album.title,
            artist: resolvedArtist,
            imageUrl: album.imageUrl,
            kind: "album",
          }}
        />
      )}
    </>
  );
}
