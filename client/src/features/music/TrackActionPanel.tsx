import { useState, useCallback, useRef, useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { useLibrary } from "./useLibrary";
import { useDeleteMusic } from "./useDeleteMusic";
import { useDownload } from "./useDownload";
import { buildMusicLink } from "./musicLinks";
import { copyToClipboard } from "@/lib/clipboard";
import { addToQueue, insertNextInQueue, setActiveDetailId } from "@/store/slices/musicSlice";
import { selectAudioSource } from "./trackParser";
import { buildTrackEvent } from "./musicEventBuilder";
import { signAndPublish, publishExisting } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { indexSpaceFeed } from "@/store/slices/eventsSlice";
import { trackFeedTimestamp } from "@/store/slices/feedSlice";
import { store } from "@/store";
import { buildChatMessage } from "@/lib/nostr/eventBuilder";
import type { UnsignedEvent } from "@/types/nostr";
import { sendDM } from "@/features/dm/dmService";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import type { Space, SpaceChannel } from "@/types/space";

import { PanelHeader } from "./panel/PanelHeader";
import { ActionsTab } from "./panel/ActionsTab";
import { NotesTab } from "./panel/NotesTab";
import { AudioTab } from "./panel/AudioTab";
import { HistoryTab } from "./panel/HistoryTab";

import { ReplaceAudioModal } from "./ReplaceAudioModal";
import { MoveTrackModal } from "./MoveTrackModal";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { RecipientPickerModal } from "@/components/sharing/RecipientPickerModal";
import { SpacePickerModal } from "@/components/sharing/SpacePickerModal";
import { MusicPostModal } from "./MusicPostModal";
import { useProfileShowcase } from "@/features/profile/useProfileShowcase";
import { buildRepost } from "@/lib/nostr/eventBuilder";
import { getTrackImage } from "./trackImage";

type TabId = "actions" | "notes" | "audio" | "history";

interface TrackActionPanelProps {
  track: MusicTrack;
  isOwner: boolean;
  isLocal: boolean;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onPublish?: () => void;
  publishing?: boolean;
  anchorRef?: RefObject<HTMLButtonElement | null>;
}

function getExtFromMime(mime?: string): string {
  if (!mime) return "mp3";
  const map: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/mp4": "m4a",
    "audio/webm": "webm",
  };
  return map[mime] ?? "mp3";
}

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

export function TrackActionPanel({
  track,
  isOwner,
  isLocal,
  open,
  onClose,
  onEdit,
  onPublish,
  publishing = false,
  anchorRef: _anchorRef,
}: TrackActionPanelProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const annotationCount = useAppSelector((s) => {
    const anns = s.music.annotations[track.addressableId];
    if (!anns) return 0;
    return anns.filter((a) => !a.isPrivate || a.authorPubkey === pubkey).length;
  });
  const { saveTrack, unsaveTrack, isTrackSaved, favoriteTrack, unfavoriteTrack, isTrackFavorited } = useLibrary();
  const { deleteTrack, deleting } = useDeleteMusic();
  const { downloadTrack, removeDownload, isDownloaded, downloading } = useDownload();

  const saved = !isLocal && isTrackSaved(track.addressableId);
  const favorited = !isLocal && isTrackFavorited(track.addressableId);
  const downloaded = isDownloaded(track.addressableId);
  const isDownloading = downloading === track.addressableId;
  const sharingDisabled = !!track.sharingDisabled;

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("actions");

  // Modal state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [replaceAudioOpen, setReplaceAudioOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const [sharingToggling, setSharingToggling] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Flash states for async actions
  const [dmSentFlash, triggerDmSent] = useFlash();
  const [spaceSharedFlash, triggerSpaceShared] = useFlash();
  const [showcaseFlash, triggerShowcase] = useFlash();
  const [repostFlash, triggerRepost] = useFlash();
  const [postModalOpen, setPostModalOpen] = useState(false);

  // Profile showcase (picks)
  const { addItem: addShowcaseItem, removeItem: removeShowcaseItem, isInShowcase } = useProfileShowcase(pubkey ?? null);
  const trackInShowcase = isInShowcase(track.addressableId);

  const anyModalOpen = replaceAudioOpen || moveOpen || playlistOpen || dmPickerOpen || spacePickerOpen || postModalOpen;

  const albums = useAppSelector((s) => s.music.albums);
  const originalEvent = useAppSelector((s) => s.events.entities[track.eventId]);

  const handleRepost = async () => {
    if (!pubkey || !originalEvent) return;
    try {
      const unsigned = buildRepost(
        pubkey,
        { id: originalEvent.id, pubkey: originalEvent.pubkey },
        JSON.stringify(originalEvent),
      );
      await signAndPublish(unsigned);
      triggerRepost();
    } catch {
      // Best-effort
    }
  };

  const panelRef = useRef<HTMLDivElement>(null);

  // Escape key — skip when a sub-modal is open (modal handles its own escape)
  useEffect(() => {
    if (!open || anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, anyModalOpen]);

  // Reset tab + confirm state when panel opens
  useEffect(() => {
    if (open) {
      setActiveTab("actions");
      setConfirmDelete(false);
    }
  }, [open]);

  // ── Handlers ──

  const handleExport = async () => {
    const url = selectAudioSource(track.variants);
    if (!url || exporting) return;
    setExporting(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${track.artist} - ${track.title}.${getExtFromMime(track.variants[0]?.mimeType)}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      // Silently fail -- user can retry
    } finally {
      setExporting(false);
    }
  };

  const handleCopyLink = () => {
    copyToClipboard(buildMusicLink(track.addressableId));
  };

  const handleSendToDM = async (recipientPubkey: string) => {
    const content = buildNaddrReference(track.addressableId);
    await sendDM(recipientPubkey, content);
    triggerDmSent();
  };

  const handleShareToSpace = async (space: Space, channel: SpaceChannel) => {
    if (!pubkey) return;
    const originalEvent = store.getState().events.entities[track.eventId];
    if (!originalEvent) return;

    relayManager.connect(space.hostRelay, "read+write");
    try {
      await relayManager.waitForConnection(space.hostRelay, 5000);
    } catch {
      // Continue anyway
    }

    if (channel.type === "music") {
      await publishExisting(originalEvent, [space.hostRelay]);
      const contextId = `${space.id}:${channel.id}`;
      dispatch(indexSpaceFeed({ contextId, eventId: track.eventId }));
      dispatch(trackFeedTimestamp({ contextId, createdAt: originalEvent.created_at }));
      dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: track.eventId }));
      dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: originalEvent.created_at }));
    } else {
      const naddr = buildNaddrReference(track.addressableId);
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
      await publishExisting(originalEvent, [space.hostRelay]);
      const allChannels = store.getState().spaces.channels[space.id] ?? [];
      const musicCh = allChannels.find((c) => c.type === "music");
      if (musicCh) {
        dispatch(indexSpaceFeed({ contextId: `${space.id}:${musicCh.id}`, eventId: track.eventId }));
        dispatch(trackFeedTimestamp({ contextId: `${space.id}:${musicCh.id}`, createdAt: originalEvent.created_at }));
      }
      dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: track.eventId }));
      dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: originalEvent.created_at }));
    }

    triggerSpaceShared();
  };

  const handlePlayNext = () => {
    dispatch(insertNextInQueue(track.addressableId));
  };

  const handleAddToQueue = () => {
    dispatch(addToQueue(track.addressableId));
  };

  const handleToggleSharing = async () => {
    if (!pubkey || sharingToggling) return;
    setSharingToggling(true);
    try {
      const existingDTag = track.addressableId.split(":").slice(2).join(":");
      const audioUrl = selectAudioSource(track.variants);
      if (!audioUrl) return;

      const unsigned = buildTrackEvent(pubkey, {
        title: track.title,
        artist: track.artist,
        slug: existingDTag,
        duration: track.duration,
        genre: track.genre || undefined,
        audioUrl,
        imageUrl: track.imageUrl,
        hashtags: track.hashtags.length > 0 ? track.hashtags : undefined,
        albumRef: track.albumRef,
        artistPubkeys: track.artistPubkeys.length > 0 ? track.artistPubkeys : undefined,
        featuredArtists: track.featuredArtists.length > 0 ? track.featuredArtists : undefined,
        visibility: track.visibility,
        sharingDisabled: !sharingDisabled,
      });

      await signAndPublish(unsigned);
    } catch {
      // Silently fail
    } finally {
      setSharingToggling(false);
    }
  };

  const handleSaveToggle = () => {
    if (saved) unsaveTrack(track.addressableId);
    else saveTrack(track.addressableId);
  };

  const handleFavoriteToggle = () => {
    if (favorited) unfavoriteTrack(track.addressableId);
    else favoriteTrack(track.addressableId);
  };

  const handleShowcaseToggle = async () => {
    if (trackInShowcase) {
      await removeShowcaseItem(track.addressableId);
    } else {
      await addShowcaseItem({ type: "track", addressableId: track.addressableId });
    }
    triggerShowcase();
  };

  const handleDelete = async () => {
    onClose();
    setConfirmDelete(false);
    await deleteTrack(track);
  };

  // ── Tab definitions ──

  const tabs: { id: TabId; label: string; badge?: number; show: boolean }[] = [
    { id: "actions", label: "Actions", show: true },
    { id: "notes", label: "Notes", badge: annotationCount > 0 ? annotationCount : undefined, show: true },
    { id: "audio", label: "Audio", show: true },
    { id: "history", label: "History", show: isOwner },
  ];

  const visibleTabs = tabs.filter((t) => t.show);

  // ── Render ──

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
            <PanelHeader track={track} onClose={onClose} />

            {/* Tab bar */}
            <div className="flex border-b border-border/40 px-2">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === tab.id
                      ? "text-heading"
                      : "text-muted hover:text-soft"
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
                <ActionsTab
                  isOwner={isOwner}
                  isLocal={isLocal}
                  saved={saved}
                  favorited={favorited}
                  downloaded={downloaded}
                  isDownloading={isDownloading}
                  sharingDisabled={sharingDisabled}
                  sharingToggling={sharingToggling}
                  exporting={exporting}
                  publishing={publishing}
                  deleting={deleting}
                  confirmDelete={confirmDelete}
                  dmSentFlash={dmSentFlash}
                  spaceSharedFlash={spaceSharedFlash}
                  onPlayNext={handlePlayNext}
                  onAddToQueue={handleAddToQueue}
                  onSaveToggle={handleSaveToggle}
                  onFavoriteToggle={handleFavoriteToggle}
                  onAddToPlaylist={() => setPlaylistOpen(true)}
                  onCopyLink={handleCopyLink}
                  onSendToDM={() => setDmPickerOpen(true)}
                  onShareToSpace={() => setSpacePickerOpen(true)}
                  onEditTrack={() => { onClose(); onEdit(); }}
                  onMove={() => setMoveOpen(true)}
                  onToggleSharing={handleToggleSharing}
                  onPublish={onPublish ? () => { onClose(); onPublish(); } : undefined}
                  onInsights={() => {
                    onClose();
                    dispatch(setActiveDetailId({ view: "insights", id: track.addressableId }));
                  }}
                  onDownload={() => downloadTrack(track)}
                  onRemoveDownload={() => removeDownload(track.addressableId)}
                  onExport={handleExport}
                  onDeleteStart={() => setConfirmDelete(true)}
                  onDeleteConfirm={handleDelete}
                  onShowcaseToggle={pubkey ? handleShowcaseToggle : undefined}
                  inShowcase={trackInShowcase}
                  showcaseFlash={showcaseFlash}
                  onRepost={!isLocal && originalEvent ? handleRepost : undefined}
                  repostFlash={repostFlash}
                  onPostWithNote={!isLocal ? () => setPostModalOpen(true) : undefined}
                />
              )}
              {activeTab === "notes" && (
                <NotesTab
                  targetRef={track.addressableId}
                  targetName={track.title}
                  ownerPubkey={track.pubkey}
                />
              )}
              {activeTab === "audio" && (
                <AudioTab
                  track={track}
                  isOwner={isOwner}
                  onReplaceAudio={() => setReplaceAudioOpen(true)}
                  onExport={handleExport}
                  exporting={exporting}
                />
              )}
              {activeTab === "history" && isOwner && (
                <HistoryTab addressableId={track.addressableId} />
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

      {/* Modals rendered outside the panel */}
      {replaceAudioOpen && (
        <ReplaceAudioModal
          track={track}
          onClose={() => setReplaceAudioOpen(false)}
          onBack={() => setReplaceAudioOpen(false)}
        />
      )}
      {moveOpen && (
        <MoveTrackModal
          track={track}
          onClose={() => setMoveOpen(false)}
          onBack={() => setMoveOpen(false)}
        />
      )}
      {playlistOpen && (
        <AddToPlaylistModal
          open={playlistOpen}
          onClose={() => setPlaylistOpen(false)}
          onBack={() => setPlaylistOpen(false)}
          trackAddrId={track.addressableId}
        />
      )}
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
            addressableId: track.addressableId,
            eventId: track.eventId,
            pubkey: track.pubkey,
            title: track.title,
            artist: track.artist,
            imageUrl: getTrackImage(track, albums),
            kind: "track",
          }}
        />
      )}
    </>
  );
}
