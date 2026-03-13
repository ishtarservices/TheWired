import { useState, type RefObject } from "react";
import {
  Heart,
  Plus,
  Check,
  Link2,
  Pencil,
  Upload,
  Trash2,
  ListPlus,
  Download,
  FolderInput,
  MessageSquare,
  BarChart3,
  Share2,
  Send,
  Globe,
} from "lucide-react";
import type { MusicTrack } from "@/types/music";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";
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
import { ReplaceAudioModal } from "./ReplaceAudioModal";
import { TrackNotesModal } from "./TrackNotesModal";
import { MoveTrackModal } from "./MoveTrackModal";
import { AddToPlaylistModal } from "./AddToPlaylistModal";
import { RecipientPickerModal } from "@/components/sharing/RecipientPickerModal";
import { SpacePickerModal } from "@/components/sharing/SpacePickerModal";
import { sendDM } from "@/features/dm/dmService";
import { buildNaddrReference } from "@/lib/nostr/naddrEncode";
import type { Space, SpaceChannel } from "@/types/space";

interface TrackActionMenuProps {
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

export function TrackActionMenu({
  track,
  isOwner,
  isLocal,
  open,
  onClose,
  onEdit,
  onPublish,
  publishing,
  anchorRef,
}: TrackActionMenuProps) {
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { saveTrack, unsaveTrack, isTrackSaved, favoriteTrack, unfavoriteTrack, isTrackFavorited } = useLibrary();
  const { deleteTrack, deleting } = useDeleteMusic();
  const { downloadTrack, removeDownload, isDownloaded, downloading } = useDownload();
  const saved = !isLocal && isTrackSaved(track.addressableId);
  const favorited = !isLocal && isTrackFavorited(track.addressableId);
  const downloaded = isDownloaded(track.addressableId);
  const isDownloading = downloading === track.addressableId;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmUnsave, setConfirmUnsave] = useState(false);
  const [replaceAudioOpen, setReplaceAudioOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [sharingToggling, setSharingToggling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dmPickerOpen, setDmPickerOpen] = useState(false);
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);

  const sharingDisabled = !!track.sharingDisabled;

  const handleExport = async () => {
    const url = selectAudioSource(track.variants);
    if (!url || exporting) return;
    onClose();
    setExporting(true);
    try {
      // Fetch as blob to force a real download instead of browser navigation
      const res = await fetch(url);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${track.artist} - ${track.title}.${getExtFromMime(track.variants[0]?.mimeType)}`;
      a.click();
      // Clean up after a short delay to ensure download starts
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    } catch {
      // Silently fail -- user can retry
    } finally {
      setExporting(false);
    }
  };

  const handleCopyLink = () => {
    onClose();
    copyToClipboard(buildMusicLink(track.addressableId));
  };

  const handleSendToDM = async (recipientPubkey: string) => {
    const content = buildNaddrReference(track.addressableId);
    await sendDM(recipientPubkey, content);
  };

  const handleShareToSpace = async (space: Space, channel: SpaceChannel) => {
    if (!pubkey) return;

    const originalEvent = store.getState().events.entities[track.eventId];
    if (!originalEvent) return;

    // Best-effort relay connection — don't block on failure
    relayManager.connect(space.hostRelay, "read+write");
    try {
      await relayManager.waitForConnection(space.hostRelay, 5000);
    } catch {
      // Continue anyway — publish will try all connected write relays as fallback
    }

    if (channel.type === "music") {
      // Direct music share: republish original track event to space relay
      await publishExisting(originalEvent, [space.hostRelay]);
      const contextId = `${space.id}:${channel.id}`;
      dispatch(indexSpaceFeed({ contextId, eventId: track.eventId }));
      dispatch(trackFeedTimestamp({ contextId, createdAt: originalEvent.created_at }));
      dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: track.eventId }));
      dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: originalEvent.created_at }));
    } else {
      // Share as a message with a nostr:naddr embed (renders as MusicEmbedCard)
      const naddr = buildNaddrReference(track.addressableId);

      if (channel.type === "chat") {
        // Kind:9 chat message, h-tagged to the space + channel
        const unsigned = buildChatMessage(pubkey, space.id, naddr, undefined, channel.id);
        await signAndPublish(unsigned, [space.hostRelay]);
      } else {
        // Kind:1 note for notes/other channel types
        const unsigned: UnsignedEvent = {
          pubkey,
          created_at: Math.floor(Date.now() / 1000),
          kind: 1,
          tags: [],
          content: naddr,
        };
        await signAndPublish(unsigned, [space.hostRelay]);
      }

      // Also republish the original track event so it appears in #music
      // and the MusicEmbedCard can resolve the track data from the relay
      await publishExisting(originalEvent, [space.hostRelay]);

      // Index track into the music channel feed
      const allChannels = store.getState().spaces.channels[space.id] ?? [];
      const musicCh = allChannels.find((c) => c.type === "music");
      if (musicCh) {
        dispatch(indexSpaceFeed({ contextId: `${space.id}:${musicCh.id}`, eventId: track.eventId }));
        dispatch(trackFeedTimestamp({ contextId: `${space.id}:${musicCh.id}`, createdAt: originalEvent.created_at }));
      }
      dispatch(indexSpaceFeed({ contextId: `${space.id}:music`, eventId: track.eventId }));
      dispatch(trackFeedTimestamp({ contextId: `${space.id}:music`, createdAt: originalEvent.created_at }));
    }
  };

  const handleAddToQueue = () => {
    onClose();
    dispatch(addToQueue(track.addressableId));
  };

  const handlePlayNext = () => {
    onClose();
    dispatch(insertNextInQueue(track.addressableId));
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
      onClose();
    } catch {
      // Silently fail -- user can retry
    } finally {
      setSharingToggling(false);
    }
  };

  const handleSaveToggle = () => {
    onClose();
    if (saved) unsaveTrack(track.addressableId);
    else saveTrack(track.addressableId);
  };

  const handleFavoriteToggle = () => {
    onClose();
    if (favorited) unfavoriteTrack(track.addressableId);
    else favoriteTrack(track.addressableId);
  };

  const handleDelete = async () => {
    onClose();
    setConfirmDelete(false);
    await deleteTrack(track);
  };

  return (
    <>
      <PopoverMenu
        open={open}
        onClose={() => {
          onClose();
          setConfirmDelete(false);
          setConfirmUnsave(false);
        }}
        position="below"
        anchorRef={anchorRef}
      >
        {/* ── Owner view ── */}
        {isOwner ? (
          <>
            {/* Sharing section */}
            {!isLocal && (
              <>
                <PopoverMenuItem
                  icon={<Share2 size={14} className={sharingDisabled ? "text-muted" : "text-green-400"} />}
                  label={
                    sharingToggling
                      ? "Toggling..."
                      : sharingDisabled
                        ? "Sharing: Disabled"
                        : "Sharing: Enabled"
                  }
                  onClick={handleToggleSharing}
                />
                <PopoverMenuSeparator />
              </>
            )}

            {/* Creative section */}
            <PopoverMenuItem
              icon={<BarChart3 size={14} />}
              label="Insights"
              onClick={() => {
                onClose();
                dispatch(setActiveDetailId({ view: "insights", id: track.addressableId }));
              }}
            />
            <PopoverMenuItem
              icon={<MessageSquare size={14} />}
              label="Notes"
              onClick={() => {
                onClose();
                setNotesOpen(true);
              }}
            />
            <PopoverMenuItem
              icon={<Upload size={14} />}
              label="Replace Audio"
              onClick={() => {
                onClose();
                setReplaceAudioOpen(true);
              }}
            />
            <PopoverMenuItem
              icon={<ListPlus size={14} />}
              label="Play Next"
              onClick={handlePlayNext}
            />
            <PopoverMenuItem
              icon={<ListPlus size={14} />}
              label="Add to Queue"
              onClick={handleAddToQueue}
            />
            <PopoverMenuItem
              icon={<ListPlus size={14} />}
              label="Add to Playlist"
              onClick={() => {
                onClose();
                setPlaylistOpen(true);
              }}
            />
            <PopoverMenuItem
              icon={<Pencil size={14} />}
              label="Edit Track"
              onClick={() => {
                onClose();
                onEdit();
              }}
            />
            {isLocal && onPublish && (
              <PopoverMenuItem
                icon={<Upload size={14} />}
                label={publishing ? "Publishing..." : "Publish to Relays"}
                onClick={() => {
                  onClose();
                  onPublish();
                }}
              />
            )}
            <PopoverMenuSeparator />

            {/* Organize section */}
            {downloaded ? (
              <PopoverMenuItem
                icon={<Download size={14} className="text-green-400" />}
                label="Remove Download"
                onClick={() => {
                  onClose();
                  removeDownload(track.addressableId);
                }}
              />
            ) : (
              <PopoverMenuItem
                icon={<Download size={14} />}
                label={isDownloading ? "Downloading..." : "Download"}
                onClick={() => {
                  onClose();
                  downloadTrack(track);
                }}
              />
            )}
            <PopoverMenuItem
              icon={<Download size={14} />}
              label={exporting ? "Exporting..." : "Export File"}
              onClick={handleExport}
            />
            <PopoverMenuItem
              icon={<FolderInput size={14} />}
              label="Move"
              onClick={() => {
                onClose();
                setMoveOpen(true);
              }}
            />
            {!isLocal && (
              <PopoverMenuItem
                icon={<Link2 size={14} />}
                label="Copy Link"
                onClick={handleCopyLink}
              />
            )}
            {!isLocal && (
              <PopoverMenuItem
                icon={<Send size={14} />}
                label="Send to DM"
                onClick={() => {
                  onClose();
                  setDmPickerOpen(true);
                }}
              />
            )}
            {!isLocal && (
              <PopoverMenuItem
                icon={<Globe size={14} />}
                label="Share to Space"
                onClick={() => {
                  onClose();
                  setSpacePickerOpen(true);
                }}
              />
            )}
            <PopoverMenuSeparator />

            {/* Danger section */}
            {confirmDelete ? (
              <PopoverMenuItem
                icon={<Trash2 size={14} />}
                label={deleting ? "Deleting..." : "Confirm Delete"}
                variant="danger"
                onClick={handleDelete}
              />
            ) : (
              <PopoverMenuItem
                icon={<Trash2 size={14} />}
                label="Delete Track"
                variant="danger"
                onClick={() => setConfirmDelete(true)}
              />
            )}
          </>
        ) : (
          <>
            {/* ── Non-owner view ── */}
            <PopoverMenuItem
              icon={<ListPlus size={14} />}
              label="Play Next"
              onClick={handlePlayNext}
            />
            <PopoverMenuItem
              icon={<ListPlus size={14} />}
              label="Add to Queue"
              onClick={handleAddToQueue}
            />
            <PopoverMenuItem
              icon={<ListPlus size={14} />}
              label="Add to Playlist"
              onClick={() => {
                onClose();
                setPlaylistOpen(true);
              }}
            />
            {!isLocal && (
              <>
                {saved && confirmUnsave ? (
                  <PopoverMenuItem
                    icon={<Trash2 size={14} />}
                    label="Confirm Remove"
                    variant="danger"
                    onClick={() => {
                      setConfirmUnsave(false);
                      handleSaveToggle();
                    }}
                  />
                ) : (
                  <PopoverMenuItem
                    icon={saved ? <Check size={14} className="text-green-400" /> : <Plus size={14} />}
                    label={saved ? "Remove from Library" : "Add to Library"}
                    onClick={() => {
                      if (saved) setConfirmUnsave(true);
                      else handleSaveToggle();
                    }}
                  />
                )}
                <PopoverMenuItem
                  icon={<Heart size={14} className={favorited ? "fill-red-500 text-red-500" : ""} />}
                  label={favorited ? "Remove from Favorites" : "Add to Favorites"}
                  onClick={handleFavoriteToggle}
                />
                <PopoverMenuItem
                  icon={<Link2 size={14} />}
                  label="Copy Link"
                  onClick={handleCopyLink}
                />
                <PopoverMenuItem
                  icon={<Send size={14} />}
                  label="Send to DM"
                  onClick={() => {
                    onClose();
                    setDmPickerOpen(true);
                  }}
                />
                <PopoverMenuItem
                  icon={<Globe size={14} />}
                  label="Share to Space"
                  onClick={() => {
                    onClose();
                    setSpacePickerOpen(true);
                  }}
                />
                {downloaded ? (
                  <PopoverMenuItem
                    icon={<Download size={14} className="text-green-400" />}
                    label="Remove Download"
                    onClick={() => {
                      onClose();
                      removeDownload(track.addressableId);
                    }}
                  />
                ) : (
                  <PopoverMenuItem
                    icon={<Download size={14} />}
                    label={isDownloading ? "Downloading..." : "Download"}
                    onClick={() => {
                      onClose();
                      downloadTrack(track);
                    }}
                  />
                )}
                {!sharingDisabled && (
                  <PopoverMenuItem
                    icon={<Download size={14} />}
                    label={exporting ? "Exporting..." : "Export File"}
                    onClick={handleExport}
                  />
                )}
              </>
            )}
          </>
        )}
      </PopoverMenu>

      {/* Modals rendered outside the popover */}
      {replaceAudioOpen && (
        <ReplaceAudioModal
          track={track}
          onClose={() => setReplaceAudioOpen(false)}
        />
      )}

      {notesOpen && (
        <TrackNotesModal
          track={track}
          onClose={() => setNotesOpen(false)}
        />
      )}
      {moveOpen && (
        <MoveTrackModal
          track={track}
          onClose={() => setMoveOpen(false)}
        />
      )}
      {playlistOpen && (
        <AddToPlaylistModal
          open={playlistOpen}
          onClose={() => setPlaylistOpen(false)}
          trackAddrId={track.addressableId}
        />
      )}
      {dmPickerOpen && (
        <RecipientPickerModal
          open={dmPickerOpen}
          onClose={() => setDmPickerOpen(false)}
          onSelect={handleSendToDM}
        />
      )}
      {spacePickerOpen && (
        <SpacePickerModal
          open={spacePickerOpen}
          onClose={() => setSpacePickerOpen(false)}
          onSelect={handleShareToSpace}
          channelTypes={["chat", "notes", "music"]}
        />
      )}
    </>
  );
}
