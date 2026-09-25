import { useState, useCallback } from "react";
import {
  X,
  Search,
  ListMusic,
  Library,
  Music,
  GripVertical,
  Play,
  Plus,
  Trash2,
  Headphones,
  Radio,
  Crown,
  Check,
} from "lucide-react";
import { useListenTogether } from "./useListenTogether";
import { useAudioPlayer } from "@/features/music/useAudioPlayer";
import { useAppSelector } from "@/store/hooks";
import { useMusicSearch } from "@/features/music/useMusicSearch";
import { getTrackImage } from "@/features/music/trackImage";
import { useResolvedArtist } from "@/features/music/useResolvedArtist";
import { VolumeBalance } from "./VolumeBalance";
import type { MusicTrack } from "@/types/music";

type PickerTab = "library" | "search" | "queue";

/**
 * Slide-out drawer for browsing and queueing music during Listen Together.
 *
 * When no session is active, shows a "Start Listen Together" landing.
 * When active, shows Library/Search/Queue tabs.
 */
export function ListenTogetherPicker() {
  const {
    active,
    isLocalDJ,
    djPubkey,
    closePicker,
    sharedQueue,
    startSession,
    endSession,
    leaveSession,
    joinSession,
    pendingInvite,
    listenerCount,
    suggestTrack,
  } = useListenTogether();
  const { play, playQueue, addToQueue } = useAudioPlayer();
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const savedTrackIds = useAppSelector((s) => s.music.library.savedTrackIds);

  // Determine room context for starting a session
  const connectedRoom = useAppSelector((s) => s.voice.connectedRoom);
  const activeCall = useAppSelector((s) => s.call.activeCall);

  const [tab, setTab] = useState<PickerTab>("library");
  const [suggested, setSuggested] = useState<ReadonlySet<string>>(() => new Set());

  // DJ queues directly; a listener suggests to the DJ instead.
  const addOrSuggest = useCallback(
    (id: string) => {
      if (isLocalDJ) {
        addToQueue(id);
      } else if (suggestTrack(id)) {
        setSuggested((prev) => new Set(prev).add(id));
      }
    },
    [isLocalDJ, addToQueue, suggestTrack],
  );

  const handleStartSession = () => {
    if (connectedRoom) {
      startSession(connectedRoom.channelId, "space");
    } else if (activeCall) {
      startSession(activeCall.roomId, "dm");
    }
  };

  const context = connectedRoom ? "space" : activeCall ? "dm" : null;

  return (
    <div className="absolute inset-y-0 right-0 z-30 w-80 flex flex-col bg-surface/95 backdrop-blur-lg border-l border-border/50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Headphones size={14} className={active ? "text-primary" : "text-muted"} />
          <span className="text-sm font-medium text-heading">
            {active ? "Listen Together" : "Music"}
          </span>
          {active && (
            <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
              Live
            </span>
          )}
        </div>
        <button
          onClick={closePicker}
          className="rounded-full p-1 text-muted hover:text-heading hover:bg-card-hover transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* ── Not active: Start Session landing or Join existing ── */}
      {!active && (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <Radio size={28} className="text-primary" />
          </div>
          {pendingInvite ? (
            <>
              <div className="text-center">
                <h3 className="text-sm font-semibold text-heading">Session Active</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  A Listen Together session is in progress.
                  {pendingInvite.trackMeta && (
                    <>
                      {" "}Now playing:{" "}
                      <span className="text-soft">{pendingInvite.trackMeta.title}</span>
                    </>
                  )}
                </p>
              </div>
              <button
                onClick={joinSession}
                className="rounded-xl bg-primary/20 px-6 py-2.5 text-sm font-semibold text-primary hover:bg-primary/30 transition-colors"
              >
                Join Session
              </button>
            </>
          ) : (
            <>
              <div className="text-center">
                <h3 className="text-sm font-semibold text-heading">Listen Together</h3>
                <p className="text-xs text-muted mt-1 leading-relaxed">
                  Share music with everyone in this{" "}
                  {context === "space" ? "voice channel" : "call"}.
                  You'll become the DJ and control playback for all listeners.
                </p>
              </div>
              {context ? (
                <button
                  onClick={handleStartSession}
                  className="rounded-xl bg-primary/20 px-6 py-2.5 text-sm font-semibold text-primary hover:bg-primary/30 transition-colors"
                >
                  Start Session
                </button>
              ) : (
                <p className="text-xs text-muted text-center">
                  Join a voice channel or start a call first
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Active: Music picker ── */}
      {active && (
        <>
          {/* Session info bar */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-primary/5 border-b border-border/30">
            <span className="flex items-center gap-1 text-[10px] text-soft">
              <Crown size={10} className="text-primary" />
              {isLocalDJ ? "You are DJ" : `DJ: ${djPubkey?.slice(0, 8)}...`}
              <span className="text-muted ml-1">
                {listenerCount} listening
              </span>
            </span>
            {isLocalDJ ? (
              <button
                onClick={endSession}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                End Session
              </button>
            ) : (
              <button
                onClick={leaveSession}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                Leave
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border/50">
            {(["library", "search", "queue"] as PickerTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  tab === t
                    ? "text-heading border-b-2 border-primary"
                    : "text-muted hover:text-soft"
                }`}
              >
                {t === "library" && <Library size={12} />}
                {t === "search" && <Search size={12} />}
                {t === "queue" && <ListMusic size={12} />}
                <span className="capitalize">{t}</span>
                {t === "queue" && sharedQueue.length > 0 && (
                  <span className="text-[10px] text-muted">({sharedQueue.length})</span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {tab === "library" && (
              <LibraryTab
                trackIds={savedTrackIds}
                tracks={tracks}
                albums={albums}
                isLocalDJ={isLocalDJ}
                onPlay={isLocalDJ ? (id: string) => play(id) : undefined}
                onAddToQueue={addOrSuggest}
                onPlayQueue={isLocalDJ ? playQueue : undefined}
                suggested={suggested}
              />
            )}
            {tab === "search" && (
              <SearchTab
                tracks={tracks}
                albums={albums}
                isLocalDJ={isLocalDJ}
                onPlay={isLocalDJ ? (id: string) => play(id) : undefined}
                onAddToQueue={addOrSuggest}
                suggested={suggested}
              />
            )}
            {tab === "queue" && (
              <QueueTab
                queue={sharedQueue}
                tracks={tracks}
                albums={albums}
                isLocalDJ={isLocalDJ}
              />
            )}
          </div>

          {/* Volume balance */}
          <div className="border-t border-border/50">
            <VolumeBalance />
          </div>
        </>
      )}
    </div>
  );
}

// ── Library Tab ───────────────────────────────────────────────────

function LibraryTab({
  trackIds,
  tracks,
  albums,
  isLocalDJ,
  onPlay,
  onAddToQueue,
  onPlayQueue,
  suggested,
}: {
  trackIds: string[];
  tracks: Record<string, MusicTrack>;
  albums: Record<string, import("@/types/music").MusicAlbum>;
  isLocalDJ: boolean;
  onPlay?: (id: string) => void;
  onAddToQueue?: (id: string) => void;
  onPlayQueue?: (ids: string[], startIndex?: number) => void;
  suggested: ReadonlySet<string>;
}) {
  const available = trackIds.filter((id) => tracks[id]).slice(0, 100);

  if (available.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted text-xs">
        <Music size={24} className="mb-2 opacity-50" />
        No saved tracks
      </div>
    );
  }

  return (
    <div className="py-1">
      {isLocalDJ && available.length > 0 && onPlayQueue && (
        <button
          onClick={() => onPlayQueue(available, 0)}
          className="w-full px-3 py-2 text-left text-xs text-primary hover:bg-primary/5 transition-colors"
        >
          Play all in call
        </button>
      )}
      {available.map((id) => {
        const track = tracks[id];
        if (!track) return null;
        return (
          <TrackRow
            key={id}
            track={track}
            albums={albums}
            onPlay={onPlay ? () => onPlay(id) : undefined}
            onAdd={onAddToQueue ? () => onAddToQueue(id) : undefined}
            actionLabel={isLocalDJ ? undefined : "Suggest"}
            done={suggested.has(id)}
          />
        );
      })}
    </div>
  );
}

// ── Search Tab ────────────────────────────────────────────────────

function SearchTab({
  tracks,
  albums,
  isLocalDJ,
  onPlay,
  onAddToQueue,
  suggested,
}: {
  tracks: Record<string, MusicTrack>;
  albums: Record<string, import("@/types/music").MusicAlbum>;
  isLocalDJ: boolean;
  onPlay?: (id: string) => void;
  onAddToQueue?: (id: string) => void;
  suggested: ReadonlySet<string>;
}) {
  const { query, setQuery, results, isSearching } = useMusicSearch();

  return (
    <div>
      <div className="px-3 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracks..."
            className="w-full rounded-lg bg-surface-hover pl-8 pr-3 py-1.5 text-xs text-heading placeholder:text-muted outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {isSearching && (
        <div className="px-3 py-4 text-center text-xs text-muted">Searching...</div>
      )}

      {!isSearching && query && results.tracks.length === 0 && (
        <div className="px-3 py-4 text-center text-xs text-muted">No results</div>
      )}

      <div className="py-1">
        {results.tracks.map((hit) => {
          const track = tracks[hit.addressable_id];
          const fakeTrack: MusicTrack = track ?? {
            addressableId: hit.addressable_id,
            eventId: hit.id,
            pubkey: hit.pubkey,
            title: hit.title,
            artist: hit.artist,
            artistPubkeys: [],
            featuredArtists: [],
            hashtags: [],
            variants: [],
            imageUrl: hit.image_url,
            createdAt: hit.created_at,
            visibility: "public" as const,
            inCatalog: true,
          };
          return (
            <TrackRow
              key={hit.addressable_id}
              track={fakeTrack}
              albums={albums}
              onPlay={onPlay ? () => onPlay(hit.addressable_id) : undefined}
              // A listener can only suggest a track it has the media for.
              onAdd={
                onAddToQueue && (isLocalDJ || track?.variants.length)
                  ? () => onAddToQueue(hit.addressable_id)
                  : undefined
              }
              actionLabel={isLocalDJ ? undefined : "Suggest"}
              done={suggested.has(hit.addressable_id)}
            />
          );
        })}
      </div>
    </div>
  );
}

function QueueItemArtist({ track }: { track: MusicTrack }) {
  const resolved = useResolvedArtist(track.artist, track.artistPubkeys);
  return <>{resolved}</>;
}

// ── Queue Tab ─────────────────────────────────────────────────────

function QueueTab({
  queue,
  tracks,
  albums,
  isLocalDJ,
}: {
  queue: string[];
  tracks: Record<string, MusicTrack>;
  albums: Record<string, import("@/types/music").MusicAlbum>;
  isLocalDJ: boolean;
}) {
  const currentTrackId = useAppSelector((s) => s.music.player.currentTrackId);
  const { removeFromQueue } = useAudioPlayer();

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted text-xs">
        <ListMusic size={24} className="mb-2 opacity-50" />
        Queue is empty
      </div>
    );
  }

  return (
    <div className="py-1">
      {queue.map((id, i) => {
        const track = tracks[id];
        if (!track) return null;
        const isCurrent = id === currentTrackId;
        const imageUrl = getTrackImage(track, albums);

        return (
          <div
            key={`${id}-${i}`}
            className={`group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors ${
              isCurrent ? "bg-primary/5" : ""
            }`}
          >
            {isLocalDJ && (
              <GripVertical size={12} className="text-muted/50 shrink-0 cursor-grab" />
            )}
            <span className="text-[10px] text-muted w-4 text-right shrink-0">
              {i + 1}
            </span>
            {imageUrl ? (
              <img src={imageUrl} alt="" className="h-7 w-7 rounded object-cover shrink-0" />
            ) : (
              <div className="h-7 w-7 rounded bg-surface-hover flex items-center justify-center shrink-0">
                <Music size={10} className="text-muted" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className={`truncate text-xs leading-tight ${isCurrent ? "text-primary font-medium" : "text-heading"}`}>
                {track.title}
              </p>
              <p className="truncate text-[10px] text-soft leading-tight">
                <QueueItemArtist track={track} />
              </p>
            </div>
            {isLocalDJ && (
              <button
                onClick={() => removeFromQueue(i)}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted hover:text-red-400 transition-all"
                title="Remove from queue"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Shared track row ──────────────────────────────────────────────

function TrackRow({
  track,
  albums,
  onPlay,
  onAdd,
  actionLabel,
  done = false,
}: {
  track: MusicTrack;
  albums: Record<string, import("@/types/music").MusicAlbum>;
  onPlay?: () => void;
  onAdd?: () => void;
  actionLabel?: string;
  /** The add/suggest action already happened — show a check instead. */
  done?: boolean;
}) {
  const imageUrl = getTrackImage(track, albums);
  const resolvedArtist = useResolvedArtist(track.artist, track.artistPubkeys);

  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors">
      {/* Art */}
      {imageUrl ? (
        <img src={imageUrl} alt="" className="h-8 w-8 rounded object-cover shrink-0" />
      ) : (
        <div className="h-8 w-8 rounded bg-surface-hover flex items-center justify-center shrink-0">
          <Music size={12} className="text-muted" />
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-heading leading-tight">
          {track.title}
        </p>
        <p className="truncate text-[10px] text-soft leading-tight">
          {resolvedArtist}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {onPlay && (
          <button
            onClick={onPlay}
            className="rounded-full p-1 text-heading hover:bg-card-hover transition-colors"
            title="Play in call"
          >
            <Play size={12} fill="currentColor" />
          </button>
        )}
        {onAdd && done && (
          <span className="rounded-full p-1 text-primary" title="Suggested">
            <Check size={12} />
          </span>
        )}
        {onAdd && !done && (
          <button
            onClick={onAdd}
            className="rounded-full p-1 text-soft hover:text-heading hover:bg-card-hover transition-colors"
            title={actionLabel ?? "Add to queue"}
          >
            <Plus size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
