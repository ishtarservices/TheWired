import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { EventDeduplicator } from "./dedup";
import { verifySpaceModAuthority } from "./mutationAuthority";
import { trackPendingDeletion, clearPendingDeletion } from "../../store/slices/eventsSlice";
import { isValidEventStructure } from "./validation";
import { verifyBridge } from "./verifyWorkerBridge";
import type { UnknownAction } from "@reduxjs/toolkit";
import { store } from "../../store";
import { putEvent, deleteEvent, deleteAddressableEvent } from "../db/eventStore";
import { addEvent, addEvents, indexChatMessage, indexReel, indexLongForm, indexLiveStream, indexNote, indexSpaceFeed, removeEventFromAllSpaceFeeds, indexMusicTrack, indexMusicAlbum, indexReply, indexRepost, indexRepostByAuthor, indexQuote, removeChatMessage, hideMessage, removeEvent, removeNote, removeRepost, trackDeletedNote, trackDeletedAddr, indexEditedMessage, indexNotes, indexReplies, indexReposts, indexRepostsByAuthor, indexQuotes, indexChatMessages, indexReels, indexLongForms, indexLiveStreams, indexMusicTracks, indexMusicAlbums, indexSpaceFeeds } from "../../store/slices/eventsSlice";
import { addReaction, addReactions, removeReactionByEventId, type ReactionInput } from "../../store/slices/reactionsSlice";
import { addTrack, indexTrackByArtist, indexTrackByAlbum, indexTrackByArtistName, indexAlbumByArtist, indexAlbumByArtistName, addAlbum, addPlaylist, addAnnotation, removeAnnotation, removeTrack, removeAlbum, removePlaylist } from "../../store/slices/musicSlice";
import { addDMMessage, editDMMessage, remoteDeleteDMMessage } from "../../store/slices/dmSlice";
import { parseTrackEvent, parsePrivateTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent, parsePrivateAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { parseAnnotationEvent } from "../../features/music/annotationParser";
import { incrementEventCount, incrementCounts } from "../../store/slices/relaysSlice";
import { trackFeedTimestamp, trackFeedTimestamps } from "../../store/slices/feedSlice";
import { SPACE_CHANNEL_ROUTES } from "../../features/spaces/spaceChannelRoutes";
import { hasMediaUrls, hasEmbedUrls } from "../media/mediaUrlParser";
import { parseThreadRef, parseQuoteRef } from "../../features/spaces/noteParser";
import { profileCache } from "./profileCache";
import { unwrapGiftWrap } from "./giftWrap";
import { evaluateNotification, evaluateDMNotification, evaluateFriendRequestNotification, evaluateFriendAcceptNotification, evaluateCollaboratorNotification } from "./notificationEvaluator";
import { addFriendRequest, markOutgoingAccepted, acceptFriendRequest, addProcessedWrapId, removeFriend, clearRemovedPubkey } from "../../store/slices/friendRequestSlice";
import { addKnownFollower } from "../../store/slices/identitySlice";
import { acceptFriendRequestAction } from "./friendRequest";
import { followUser } from "./follow";
import { setIncomingCall, missedCall, endCall, addProcessedCallWrapId } from "../../store/slices/callSlice";
import { addEmojiSet, setUserEmojis, setSpaceEmojiSets } from "../../store/slices/emojiSlice";
import { parseEmojiSetEvent, parseUserEmojiListEvent } from "../../features/emoji/emojiSetParser";
import { parseRTCSignal } from "./callSignaling";
import type { CallType } from "../../types/calling";
import { scheduleMemberSync } from "../../store/thunks/spaceMembers";
import {
  applyNativeGroupEvent,
  applyNativeLayoutEvent,
  applyNativeRelaySetEvent,
} from "../../features/spaces/nip29SpaceSync";
import { createLogger, shortKey, shortRelay } from "../debug/logger";

const log = createLogger("pipeline");
const latencyLog = createLogger("latency");

/** Gated per-message receive-latency probe (enable with `wiredDebug.enable("latency")`).
 *  Splits the delay into transit (sender→here) and pipeline (verify+dispatch here),
 *  tagged by the delivering relay — so a self-hosted/loopback group can be compared
 *  against a platform space to localize where time goes. `transit` uses the event's
 *  second-granularity `created_at`, so it carries ±1s noise + any clock skew; the
 *  `pipeline` figure is monotonic and exact. */
function logChatLatency(event: NostrEvent, relayUrl: string, receivedAt: number): void {
  const transit = receivedAt - event.created_at * 1000;
  const pipeline = Date.now() - receivedAt;
  latencyLog.info(
    `kind:9 ${event.id.slice(0, 8)} via ${shortRelay(relayUrl)} — transit ~${transit}ms · pipeline ${pipeline}ms`,
  );
}

const dedup = new EventDeduplicator();

// Cached Set for space author lookups (O(1) instead of O(n) per check)
const authorSetCache = new Map<string, { set: Set<string>; fingerprint: string }>();

// ── Burst-path dispatch batching ──────────────────────────────────────
// At ~600 events/sec, dispatching addEvent + index actions individually pegs
// the main thread (every store.dispatch re-runs every mounted selector). We
// buffer the burst path (events from real relays) and flush coalesced
// array-dispatches on a short timer. Synthetic sources (optimistic sends,
// resolvers) flush synchronously so callers that await still read fresh state.
const FLUSH_MS = 50;
const FLUSH_CHAT_MS = 16; // chat is perceptibly live — flush within ~one frame
const MAX_BUFFER = 256; // hard cap: flush early on backfill / background-tab bursts

interface PipelineBuffer {
  events: NostrEvent[];
  counts: Record<string, number>;
  notes: { pubkey: string; eventId: string }[];
  reactions: ReactionInput[];
  replies: { parentEventId: string; eventId: string }[];
  reposts: { targetEventId: string; eventId: string }[];
  repostsByAuthor: { pubkey: string; eventId: string }[];
  quotes: { targetEventId: string; eventId: string }[];
  chatMessages: { groupId: string; eventId: string }[];
  reels: { contextId: string; eventId: string }[];
  longform: { contextId: string; eventId: string }[];
  liveStreams: { contextId: string; eventId: string }[];
  musicTracks: { contextId: string; eventId: string }[];
  musicAlbums: { contextId: string; eventId: string }[];
  spaceFeeds: { contextId: string; eventId: string }[];
  feedTimestamps: { contextId: string; createdAt: number }[];
}

function emptyBuffer(): PipelineBuffer {
  return {
    events: [], counts: {}, notes: [], reactions: [], replies: [], reposts: [],
    repostsByAuthor: [], quotes: [], chatMessages: [], reels: [], longform: [],
    liveStreams: [], musicTracks: [], musicAlbums: [], spaceFeeds: [], feedTimestamps: [],
  };
}

let buf: PipelineBuffer = emptyBuffer();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledDelay = FLUSH_MS;

/** True when the event arrived from a real relay (ws://) rather than a synthetic
 *  source: "local" (optimistic sends) or "resolve"/"search"/"browse"/"embedded". */
function isBurstSource(relayUrl: string): boolean {
  return relayUrl.startsWith("ws://") || relayUrl.startsWith("wss://");
}

/** Route a Redux action through the burst buffer when batchable, else dispatch
 *  immediately. RTK `.match` keeps each payload strongly typed. */
function emit(action: UnknownAction): void {
  if (addEvent.match(action)) { buf.events.push(action.payload); return; }
  if (incrementEventCount.match(action)) {
    const url = action.payload;
    buf.counts[url] = (buf.counts[url] ?? 0) + 1;
    return;
  }
  if (indexNote.match(action)) { buf.notes.push(action.payload); return; }
  if (addReaction.match(action)) { buf.reactions.push(action.payload); return; }
  if (indexReply.match(action)) { buf.replies.push(action.payload); return; }
  if (indexRepost.match(action)) { buf.reposts.push(action.payload); return; }
  if (indexRepostByAuthor.match(action)) { buf.repostsByAuthor.push(action.payload); return; }
  if (indexQuote.match(action)) { buf.quotes.push(action.payload); return; }
  if (indexChatMessage.match(action)) { buf.chatMessages.push(action.payload); return; }
  if (indexReel.match(action)) { buf.reels.push(action.payload); return; }
  if (indexLongForm.match(action)) { buf.longform.push(action.payload); return; }
  if (indexLiveStream.match(action)) { buf.liveStreams.push(action.payload); return; }
  if (indexMusicTrack.match(action)) { buf.musicTracks.push(action.payload); return; }
  if (indexMusicAlbum.match(action)) { buf.musicAlbums.push(action.payload); return; }
  if (indexSpaceFeed.match(action)) { buf.spaceFeeds.push(action.payload); return; }
  if (trackFeedTimestamp.match(action)) { buf.feedTimestamps.push(action.payload); return; }
  store.dispatch(action); // not batchable → immediate
}

function bufferHasData(b: PipelineBuffer): boolean {
  return (
    b.events.length > 0 || b.notes.length > 0 || b.reactions.length > 0 ||
    b.replies.length > 0 || b.reposts.length > 0 || b.repostsByAuthor.length > 0 ||
    b.quotes.length > 0 || b.chatMessages.length > 0 || b.reels.length > 0 ||
    b.longform.length > 0 || b.liveStreams.length > 0 || b.musicTracks.length > 0 ||
    b.musicAlbums.length > 0 || b.spaceFeeds.length > 0 || b.feedTimestamps.length > 0 ||
    Object.keys(b.counts).length > 0
  );
}

/** Schedule a coalesced flush of the burst buffer. Chat flushes within ~a frame;
 *  everything else within FLUSH_MS. A full buffer flushes immediately. */
function scheduleFlush(kind: number): void {
  if (buf.events.length >= MAX_BUFFER) {
    flushEventPipeline();
    return;
  }
  const delay = kind === EVENT_KINDS.CHAT_MESSAGE ? FLUSH_CHAT_MS : FLUSH_MS;
  if (flushTimer !== null) {
    if (delay >= scheduledDelay) return; // already scheduled at least this soon
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  scheduledDelay = delay;
  flushTimer = setTimeout(flushEventPipeline, delay);
}

/** Apply all buffered burst-path ops in one batch — events first, then indices,
 *  so every index entry's event is already in the adapter. Exported for tests
 *  and for synchronous flushing on logout / account switch. */
export function flushEventPipeline(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  scheduledDelay = FLUSH_MS;
  if (!bufferHasData(buf)) return;
  const b = buf;
  buf = emptyBuffer();
  // Entities first — indices reference them.
  if (b.events.length) store.dispatch(addEvents(b.events));
  if (Object.keys(b.counts).length) store.dispatch(incrementCounts(b.counts));
  if (b.notes.length) store.dispatch(indexNotes(b.notes));
  if (b.reactions.length) store.dispatch(addReactions(b.reactions));
  if (b.replies.length) store.dispatch(indexReplies(b.replies));
  if (b.reposts.length) store.dispatch(indexReposts(b.reposts));
  if (b.repostsByAuthor.length) store.dispatch(indexRepostsByAuthor(b.repostsByAuthor));
  if (b.quotes.length) store.dispatch(indexQuotes(b.quotes));
  if (b.chatMessages.length) store.dispatch(indexChatMessages(b.chatMessages));
  if (b.reels.length) store.dispatch(indexReels(b.reels));
  if (b.longform.length) store.dispatch(indexLongForms(b.longform));
  if (b.liveStreams.length) store.dispatch(indexLiveStreams(b.liveStreams));
  if (b.musicTracks.length) store.dispatch(indexMusicTracks(b.musicTracks));
  if (b.musicAlbums.length) store.dispatch(indexMusicAlbums(b.musicAlbums));
  if (b.spaceFeeds.length) store.dispatch(indexSpaceFeeds(b.spaceFeeds));
  if (b.feedTimestamps.length) store.dispatch(trackFeedTimestamps(b.feedTimestamps));
}

/** Clear all module-level caches (used during account switch) */
export function resetEventPipelineCaches(): void {
  // Drop any pending burst buffer so a stray timer can't repopulate the store
  // after RESET_ALL wipes it on account switch.
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  buf = emptyBuffer();
  scheduledDelay = FLUSH_MS;
  dedup.clear();
  authorSetCache.clear();
}

/** Get or create a cached Set from a pubkey array (keyed by cacheKey) */
function getCachedSet(cacheKey: string, pubkeys: string[]): Set<string> {
  // Cheap fingerprint: length + first + last pubkey
  const fingerprint = `${pubkeys.length}:${pubkeys[0] ?? ""}:${pubkeys[pubkeys.length - 1] ?? ""}`;
  const cached = authorSetCache.get(cacheKey);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.set;
  }
  const set = new Set(pubkeys);
  authorSetCache.set(cacheKey, { set, fingerprint });
  return set;
}

// Precompute the set of non-htag kinds for early return in space feed indexing
const spaceFeedKinds = new Set<number>();
for (const [, route] of Object.entries(SPACE_CHANNEL_ROUTES)) {
  if (route.filterMode !== "htag") {
    for (const kind of route.kinds) {
      spaceFeedKinds.add(kind);
    }
  }
}
// SHORT_TEXT also cross-indexes to media feed
spaceFeedKinds.add(EVENT_KINDS.SHORT_TEXT);

/**
 * Main event processing pipeline:
 * 1. Structural validation
 * 2. Dedup check (LRU)
 * 3. Signature verification (Web Worker)
 * 4. Dispatch to Redux + index
 */
export async function processIncomingEvent(
  event: unknown,
  relayUrl: string,
): Promise<void> {
  // Wall-clock arrival at the pipeline — used by the gated "latency" probe to
  // split transit (sender→here) from pipeline (verify+dispatch) per relay.
  const receivedAt = Date.now();

  // Step 1: Structural validation (fast, sync)
  if (!isValidEventStructure(event)) {
    if ((event as { kind?: number })?.kind === 9) {
      console.warn("[pipeline] kind:9 dropped — invalid structure", event);
    }
    return;
  }

  // Step 2: Dedup
  if (dedup.isDuplicate(event.id)) {
    if (event.kind === EVENT_KINDS.METADATA) {
      log.debug(`kind:0 ${shortKey(event.pubkey)} dropped as duplicate (already processed) from ${shortRelay(relayUrl)}`);
    }
    return;
  }
  dedup.markSeen(event.id);

  // Step 3: Signature verification (Web Worker, async)
  try {
    const valid = await verifyBridge.verify(event);
    if (!valid) {
      if (event.kind === 9) console.warn("[pipeline] kind:9 verify FAIL", event.id.slice(0, 8));
      if (event.kind === EVENT_KINDS.METADATA) log.warn(`kind:0 ${shortKey(event.pubkey)} verify FAIL from ${shortRelay(relayUrl)} — profile rejected`);
      // Unmark so the event can be retried from another relay
      dedup.unmarkSeen(event.id);
      return;
    }
  } catch (err) {
    if (event.kind === 9) console.warn("[pipeline] kind:9 verify ERROR", err);
    if (event.kind === EVENT_KINDS.METADATA) log.warn(`kind:0 ${shortKey(event.pubkey)} verify ERROR from ${shortRelay(relayUrl)}`, err);
    // Verification timeout or worker error — unmark so retry is possible
    dedup.unmarkSeen(event.id);
    return;
  }

  // Step 4: Handle gift wraps specially (don't add to general event store)
  if (event.kind === EVENT_KINDS.GIFT_WRAP) {
    store.dispatch(incrementEventCount(relayUrl));
    handleGiftWrap(event);
    return;
  }

  // Handle WebRTC signaling events (kind:25050) — ephemeral, don't store
  if (event.kind === EVENT_KINDS.WEBRTC_SIGNAL) {
    store.dispatch(incrementEventCount(relayUrl));
    handleWebRTCSignal(event);
    return;
  }

  // Step 3b: Reject re-delivered deleted notes/reposts
  if (
    (event.kind === EVENT_KINDS.SHORT_TEXT || event.kind === EVENT_KINDS.REPOST) &&
    store.getState().events.deletedNoteIds[event.id]
  ) {
    return;
  }

  // Step 3c: Reject re-delivered deleted addressable events (music tracks/albums/etc.)
  // External relays may not process "a" tag deletions, so they re-deliver events
  // that our relay has already deleted. Check against persisted deletion timestamps.
  if (event.kind >= 30000 && event.kind < 40000) {
    const dTag = event.tags.find((t: string[]) => t[0] === "d")?.[1];
    if (dTag !== undefined) {
      const addr = `${event.kind}:${event.pubkey}:${dTag}`;
      const deletedAt = store.getState().events.deletedAddrIds[addr];
      if (deletedAt !== undefined && event.created_at <= deletedAt) {
        return;
      }
    }
  }

  // Step 3d: Resolve a pending kind:5 deletion now that the target has arrived.
  // A deletion is only honored if one of the requesters actually authored this
  // event (#21) — so a third party that published a kind:5 for an id it doesn't
  // own can no longer suppress the real note when it shows up.
  const pendingDeleters = store.getState().events.pendingDeletions[event.id];
  if (pendingDeleters && pendingDeleters.length > 0) {
    const authorized = pendingDeleters.includes(event.pubkey);
    store.dispatch(clearPendingDeletion(event.id));
    if (authorized && (event.kind === EVENT_KINDS.SHORT_TEXT || event.kind === EVENT_KINDS.REPOST)) {
      store.dispatch(trackDeletedNote(event.id));
      deleteEvent(event.id).catch(() => {});
      return;
    }
    if (authorized && event.kind === EVENT_KINDS.CHAT_MESSAGE) {
      store.dispatch(hideMessage(event.id));
      deleteEvent(event.id).catch(() => {});
      return;
    }
    // Otherwise (unauthorized deleter, or a kind we don't pre-suppress) fall
    // through and index the event normally.
  }

  // Step 4: Dispatch to store (buffered on the burst path — see flushEventPipeline).
  // Reactions (kind:7) are NOT stored as full events — they fold into the
  // reaction aggregate (reactionsSlice) in indexEvent, saving memory on hot notes.
  if (event.kind !== EVENT_KINDS.REACTION) emit(addEvent(event));
  emit(incrementEventCount(relayUrl));

  // Gated receive-latency probe for group chat (kind:9 with an `h` tag), so a
  // self-hosted/loopback group's delivery can be compared against a platform space.
  if (event.kind === EVENT_KINDS.CHAT_MESSAGE && event.tags.some((t) => t[0] === "h")) {
    logChatLatency(event, relayUrl, receivedAt);
  }

  // Step 4b: Wire kind:0 events into the profile cache
  if (event.kind === EVENT_KINDS.METADATA) {
    log.debug(`kind:0 ${shortKey(event.pubkey)} reached pipeline from ${shortRelay(relayUrl)} → handing to profile cache`);
    profileCache.handleProfileEvent(event, relayUrl);
  }

  // Step 4c: Persist addressable events to IndexedDB (music, longform, etc.)
  // so they survive page refresh
  if (event.kind >= 30000 && event.kind < 40000) {
    putEvent(event).catch(() => {/* best-effort persistence */});
  }

  // Step 5: Index by kind (may await NIP-44 decryption for private music events)
  await indexEvent(event);

  // Step 6: Evaluate for notifications (unread badges, toasts)
  evaluateNotification(event);

  // Step 7: Flush. Synthetic sources (optimistic sends, resolvers) flush now so
  // awaiting callers read fresh state; real-relay bursts coalesce on a timer.
  if (isBurstSource(relayUrl)) scheduleFlush(event.kind);
  else flushEventPipeline();
}

async function indexEvent(event: NostrEvent): Promise<void> {
  const hTag = event.tags.find((t) => t[0] === "h")?.[1];

  switch (event.kind) {
    case EVENT_KINDS.SHORT_TEXT: {
      emit(indexNote({ pubkey: event.pubkey, eventId: event.id }));
      // Index as reply if it has thread references
      const threadRef = parseThreadRef(event);
      if (threadRef.rootId) {
        emit(indexReply({ parentEventId: threadRef.rootId, eventId: event.id }));
        if (threadRef.replyId && threadRef.replyId !== threadRef.rootId) {
          emit(indexReply({ parentEventId: threadRef.replyId, eventId: event.id }));
        }
      }
      // Index as quote if it has a "q" tag
      const quoteRef = parseQuoteRef(event);
      if (quoteRef) {
        emit(indexQuote({ targetEventId: quoteRef.eventId, eventId: event.id }));
      }
      break;
    }
    case EVENT_KINDS.REACTION: {
      // NIP-25: last "e" tag is the target event. Fold into the reaction
      // aggregate (count + emoji + who reacted) rather than storing the event.
      const lastETag = [...event.tags].reverse().find((t) => t[0] === "e");
      if (lastETag?.[1]) {
        emit(addReaction({
          targetEventId: lastETag[1],
          reactor: event.pubkey,
          content: event.content,
          eventId: event.id,
        }));
      }
      break;
    }
    case EVENT_KINDS.REPOST: {
      const eTag = event.tags.find((t) => t[0] === "e");
      if (eTag?.[1]) {
        emit(indexRepost({ targetEventId: eTag[1], eventId: event.id }));
      }
      emit(indexRepostByAuthor({ pubkey: event.pubkey, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.CHAT_MESSAGE: {
      // Check if this is an edit event (has ["e", ..., "edit"] tag)
      const editTag = event.tags.find((t) => t[0] === "e" && t[3] === "edit");
      if (editTag?.[1]) {
        const originalId = editTag[1];
        // Apply buffered adds so a same-burst original message resolves.
        flushEventPipeline();
        const state = store.getState();
        const originalEvent = state.events.entities[originalId];
        // Only accept edits from the same author
        if (originalEvent && originalEvent.pubkey === event.pubkey) {
          store.dispatch(indexEditedMessage({ originalId, editEventId: event.id }));
          // Store the edit event but do NOT add to chatMessages index
        }
        break;
      }

      if (hTag) {
        const channelTag = event.tags.find((t) => t[0] === "channel")?.[1];

        if (channelTag) {
          // New-style: explicit channel tag → index per-channel
          const indexKey = `${hTag}:${channelTag}`;
          emit(indexChatMessage({ groupId: indexKey, eventId: event.id }));
          emit(trackFeedTimestamp({ contextId: indexKey, createdAt: event.created_at }));
        } else {
          // Legacy: no channel tag → route to default chat channel if known
          const state = store.getState();
          const spaceChannels = state.spaces.channels[hTag];
          const defaultChat = spaceChannels?.find((c) => c.type === "chat" && c.isDefault)
            ?? spaceChannels?.find((c) => c.type === "chat");

          if (defaultChat) {
            const indexKey = `${hTag}:${defaultChat.id}`;
            emit(indexChatMessage({ groupId: indexKey, eventId: event.id }));
            emit(trackFeedTimestamp({ contextId: indexKey, createdAt: event.created_at }));
          } else {
            // Channels not loaded yet — fall back to space-level indexing
            emit(indexChatMessage({ groupId: hTag, eventId: event.id }));
            emit(trackFeedTimestamp({ contextId: hTag, createdAt: event.created_at }));
          }
        }
      }
      break;
    }
    case EVENT_KINDS.VIDEO_VERTICAL:
    case EVENT_KINDS.VIDEO_VERTICAL_ADDR: {
      const contextId = hTag ?? "global";
      emit(indexReel({ contextId, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.LONG_FORM: {
      const contextId = hTag ?? "global";
      emit(indexLongForm({ contextId, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.LIVE_STREAM: {
      const contextId = hTag ?? "global";
      emit(indexLiveStream({ contextId, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.MUSIC_TRACK: {
      emit(indexMusicTrack({ contextId: hTag ?? "global", eventId: event.id }));

      // Helper to dispatch track into Redux + artist/collaborator indices
      const dispatchTrack = (track: import("../../types/music").MusicTrack) => {
        store.dispatch(addTrack(track));
        if (track.artistPubkeys.length > 0) {
          for (const pk of track.artistPubkeys) {
            store.dispatch(indexTrackByArtist({ pubkey: pk, addressableId: track.addressableId }));
          }
        } else if (track.artist && track.artist !== event.pubkey) {
          store.dispatch(indexTrackByArtistName({ normalizedName: track.artist.toLowerCase().trim(), addressableId: track.addressableId }));
        } else {
          store.dispatch(indexTrackByArtist({ pubkey: event.pubkey, addressableId: track.addressableId }));
        }
        for (const fp of track.featuredArtists) {
          store.dispatch(indexTrackByArtist({ pubkey: fp, addressableId: track.addressableId }));
        }
        // Index by collaborator pubkeys so they can discover via selectMyCollaborations
        for (const cp of track.collaborators) {
          store.dispatch(indexTrackByArtist({ pubkey: cp, addressableId: track.addressableId }));
        }
        if (track.albumRef) {
          store.dispatch(indexTrackByAlbum({ albumAddrId: track.albumRef, trackAddrId: track.addressableId }));
        }
      };

      const isPrivate = event.tags.some(
        (t) => t[0] === "visibility" && (t[1] === "private" || t[1] === "unlisted"),
      );

      if (isPrivate && event.content) {
        // Private track with encrypted content — attempt async decryption
        const myPubkey = store.getState().identity.pubkey;
        if (myPubkey) {
          // Await the decrypt so the track is in Redux before signAndPublish returns
          try {
            const track = await parsePrivateTrackEvent(event, myPubkey);
            if (track) {
              dispatchTrack(track);
              // Notify collaborator if this is not our own event
              if (event.pubkey !== myPubkey && track.collaborators.includes(myPubkey)) {
                evaluateCollaboratorNotification(event, track.title, track.addressableId);
              }
            }
          } catch {
            // Can't decrypt = not authorized, silently skip
          }
        }
      } else {
        // Public, space, or legacy private (no encrypted content)
        const track = parseTrackEvent(event);
        dispatchTrack(track);
        // Notify if we're tagged as collaborator/featured on someone else's track
        const myPubkey = store.getState().identity.pubkey;
        if (myPubkey && event.pubkey !== myPubkey) {
          const isTagged = track.collaborators.includes(myPubkey) ||
            track.featuredArtists.includes(myPubkey);
          if (isTagged) {
            evaluateCollaboratorNotification(event, track.title, track.addressableId);
          }
        }
      }
      break;
    }
    case EVENT_KINDS.MUSIC_ALBUM: {
      emit(indexMusicAlbum({ contextId: hTag ?? "global", eventId: event.id }));

      const dispatchAlbum = (album: import("../../types/music").MusicAlbum) => {
        store.dispatch(addAlbum(album));
        if (album.artistPubkeys.length > 0) {
          for (const pk of album.artistPubkeys) {
            store.dispatch(indexAlbumByArtist({ pubkey: pk, addressableId: album.addressableId }));
          }
        } else if (album.artist && album.artist !== event.pubkey) {
          store.dispatch(indexAlbumByArtistName({ normalizedName: album.artist.toLowerCase().trim(), addressableId: album.addressableId }));
        } else {
          store.dispatch(indexAlbumByArtist({ pubkey: event.pubkey, addressableId: album.addressableId }));
        }
        for (const fp of album.featuredArtists) {
          store.dispatch(indexAlbumByArtist({ pubkey: fp, addressableId: album.addressableId }));
        }
        // Index by collaborator pubkeys
        for (const cp of album.collaborators) {
          store.dispatch(indexAlbumByArtist({ pubkey: cp, addressableId: album.addressableId }));
        }
      };

      const isPrivateAlbum = event.tags.some(
        (t) => t[0] === "visibility" && (t[1] === "private" || t[1] === "unlisted"),
      );

      if (isPrivateAlbum && event.content) {
        const myPubkey = store.getState().identity.pubkey;
        if (myPubkey) {
          try {
            const album = await parsePrivateAlbumEvent(event, myPubkey);
            if (album) {
              dispatchAlbum(album);
              if (event.pubkey !== myPubkey && album.collaborators.includes(myPubkey)) {
                evaluateCollaboratorNotification(event, album.title, album.addressableId);
              }
            }
          } catch {
            // Can't decrypt = not authorized
          }
        }
      } else {
        const album = parseAlbumEvent(event);
        dispatchAlbum(album);
        // Notify if we're tagged as collaborator/featured on someone else's album
        const myPubkey = store.getState().identity.pubkey;
        if (myPubkey && event.pubkey !== myPubkey) {
          const isTagged = album.collaborators.includes(myPubkey) ||
            album.featuredArtists.includes(myPubkey);
          if (isTagged) {
            evaluateCollaboratorNotification(event, album.title, album.addressableId);
          }
        }
      }
      break;
    }
    case EVENT_KINDS.MUSIC_PLAYLIST: {
      const playlist = parsePlaylistEvent(event);
      store.dispatch(addPlaylist(playlist));
      break;
    }
    case EVENT_KINDS.MUSIC_TRACK_NOTES: {
      const annotation = parseAnnotationEvent(event);
      if (annotation) {
        store.dispatch(addAnnotation(annotation));
      }
      break;
    }
    case EVENT_KINDS.DELETION: {
      // NIP-09: Process deletion events -- remove referenced content.
      // Only process deletions from the same author (can't delete others' content).
      // Crucially, a deletion only applies to events created BEFORE the deletion.
      // Re-published addressable events (same kind:pubkey:d-tag but newer created_at)
      // supersede the deletion and must NOT be removed.
      // Apply any buffered adds first so same-burst deletion targets resolve.
      flushEventPipeline();
      const state = store.getState();
      for (const tag of event.tags) {
        if (tag[0] === "a" && tag[1]) {
          const addr = tag[1];
          const [kindStr, addrPubkey] = addr.split(":");
          if (addrPubkey !== event.pubkey) continue;
          const kind = parseInt(kindStr, 10);
          const addrDTag = addr.split(":").slice(2).join(":");

          // Track this deletion so future re-deliveries from external relays are blocked
          store.dispatch(trackDeletedAddr({ addr, deletedAt: event.created_at }));

          if (kind === EVENT_KINDS.MUSIC_TRACK) {
            const track = state.music.tracks[addr];
            if (track && track.createdAt <= event.created_at) {
              deleteAddressableEvent(kind, addrPubkey, addrDTag).catch(() => {});
              store.dispatch(removeTrack(addr));
            }
          } else if (kind === EVENT_KINDS.MUSIC_ALBUM) {
            const album = state.music.albums[addr];
            if (album && album.createdAt <= event.created_at) {
              deleteAddressableEvent(kind, addrPubkey, addrDTag).catch(() => {});
              store.dispatch(removeAlbum(addr));
            }
          } else if (kind === EVENT_KINDS.MUSIC_PLAYLIST) {
            const playlist = state.music.playlists[addr];
            if (playlist && playlist.createdAt <= event.created_at) {
              deleteAddressableEvent(kind, addrPubkey, addrDTag).catch(() => {});
              store.dispatch(removePlaylist(addr));
            }
          } else if (kind === EVENT_KINDS.MUSIC_TRACK_NOTES) {
            for (const [targetRef, anns] of Object.entries(state.music.annotations)) {
              const match = anns.find((a) => a.addressableId === addr);
              if (match && match.createdAt <= event.created_at) {
                store.dispatch(removeAnnotation({ targetRef, addressableId: addr }));
                break;
              }
            }
          }
        }
        // Handle "e" tag deletions (by event ID) — only if the referenced
        // event is authored by the deletion event's author.
        if (tag[0] === "e" && tag[1]) {
          // Reactions aren't stored as entities — clear them from the aggregate
          // via its reverse index (no-op if the id isn't a known reaction).
          store.dispatch(removeReactionByEventId({ eventId: tag[1], byPubkey: event.pubkey }));
          const refEvent = state.events.entities[tag[1]];
          if (refEvent) {
            // Target known — apply NIP-09 directly: only the author may delete it.
            if (refEvent.pubkey === event.pubkey) {
              // Safety: don't let "e" tag deletions cascade to addressable music
              // events. Those must ONLY be deleted via "a" tags (handled above)
              // to properly respect the created_at supersedence rule.
              const isAddressableEvent = refEvent.kind >= 30000 && refEvent.kind < 40000;
              if (!isAddressableEvent) {
                deleteEvent(tag[1]).catch(() => {});
              }
              if (refEvent.kind === EVENT_KINDS.CHAT_MESSAGE) {
                const refHTag = refEvent.tags.find((t) => t[0] === "h")?.[1];
                if (refHTag) {
                  const refChannelTag = refEvent.tags.find((t) => t[0] === "channel")?.[1];
                  const contextId = refChannelTag ? `${refHTag}:${refChannelTag}` : refHTag;
                  store.dispatch(removeChatMessage({ contextId, eventId: tag[1] }));
                }
                store.dispatch(hideMessage(tag[1]));
                store.dispatch(removeEvent(tag[1]));
              } else if (refEvent.kind === EVENT_KINDS.SHORT_TEXT) {
                store.dispatch(removeNote({ pubkey: event.pubkey, eventId: tag[1] }));
                store.dispatch(removeEvent(tag[1]));
                store.dispatch(trackDeletedNote(tag[1]));
              } else if (refEvent.kind === EVENT_KINDS.REPOST) {
                store.dispatch(removeRepost({ pubkey: event.pubkey, eventId: tag[1] }));
                store.dispatch(removeEvent(tag[1]));
                store.dispatch(trackDeletedNote(tag[1]));
              }
            }
            // else: a non-author asked to delete a known event — ignore it.
          } else {
            // Target not in the store yet. Record the request as PENDING instead of
            // suppressing on faith — it is applied only if the target, when it
            // arrives, was actually authored by this deleter (#21). Do NOT delete
            // from IndexedDB here.
            store.dispatch(trackPendingDeletion({ eventId: tag[1], deleter: event.pubkey }));
          }
        }
      }
      // Persist the deletion event itself so we can check on next startup
      putEvent(event).catch(() => {});
      break;
    }
    case EVENT_KINDS.EMOJI_SET: {
      // NIP-30: Custom emoji set (kind:30030)
      const emojiSet = parseEmojiSetEvent(event);
      store.dispatch(addEmojiSet(emojiSet));
      // Track space-scoped emoji sets
      const emojiHTag = event.tags.find((t) => t[0] === "h")?.[1];
      if (emojiHTag) {
        const state = store.getState();
        const existing = state.emoji.spaceEmojiSets[emojiHTag] ?? [];
        if (!existing.includes(emojiSet.addressableId)) {
          store.dispatch(setSpaceEmojiSets({ spaceId: emojiHTag, setIds: [...existing, emojiSet.addressableId] }));
        }
      }
      break;
    }
    case EVENT_KINDS.USER_EMOJI_LIST: {
      // NIP-51: User emoji list (kind:10030)
      const myPubkey = store.getState().identity.pubkey;
      if (event.pubkey === myPubkey) {
        const { emojis } = parseUserEmojiListEvent(event);
        store.dispatch(setUserEmojis(emojis));
      }
      break;
    }
    case EVENT_KINDS.APP_SPECIFIC_DATA: {
      // kind:30078 overlays for native spaces, each guarded by its d-tag prefix
      // so unrelated 30078 uses (DM read-state) pass through:
      //   wired:relays:<id>  — mirror relay set (M9)
      //   wired:/obelisk:layout — channel layout (M4)
      if (!applyNativeRelaySetEvent(event)) {
        applyNativeLayoutEvent(event);
      }
      break;
    }
    case EVENT_KINDS.GROUP_METADATA:
    case EVENT_KINDS.GROUP_ADMINS: {
      // Relay-authoritative NIP-29 state (39000 metadata / 39001 admins). Applied
      // only to nip29-native spaces; a no-op for platform/A-lite (backend owns those).
      applyNativeGroupEvent(event);
      break;
    }
    case EVENT_KINDS.GROUP_MEMBERS: {
      // NIP-29 kind:39002 (replaceable group members list). Native spaces
      // synthesize members directly from the relay event; platform / A-lite
      // spaces stay backend-authoritative and trigger a debounced refetch.
      if (!applyNativeGroupEvent(event)) {
        const dTag = event.tags.find((t) => t[0] === "d")?.[1];
        if (dTag && store.getState().spaces.list.some((s) => s.id === dTag)) {
          scheduleMemberSync(dTag, store.dispatch);
        }
      }
      break;
    }
    case EVENT_KINDS.MOD_DELETE_EVENT: {
      // NIP-29 kind:9005: moderator delete — admin removes a message from the group.
      const groupId = event.tags.find((t) => t[0] === "h")?.[1];
      if (!groupId) break;

      // #5 — authority check. The chat read set includes non-enforcing mirrors and
      // imported relays, so anyone could publish a 9005 to wipe arbitrary messages.
      // Require the author to be in the space's pinned authority set.
      const space = store.getState().spaces.list.find((s) => s.id === groupId);
      const verdict = verifySpaceModAuthority(event, space);
      if (verdict === "defer-unknown-space") {
        // Space not loaded yet (rare race: spaces hydrate before chat subs open).
        // Drop without persisting and unmark so a relay redelivery can retry once
        // the space metadata is present.
        dedup.unmarkSeen(event.id);
        break;
      }
      if (verdict === "drop-unauthorized") {
        break;
      }

      // Apply buffered adds first so refs to same-burst messages resolve.
      flushEventPipeline();
      for (const tag of event.tags) {
        if (tag[0] === "e" && tag[1]) {
          const refEvent = store.getState().events.entities[tag[1]];
          if (refEvent) {
            // Scope hardening: only delete messages that actually belong to THIS
            // group, so an admin of one (e.g. self-imported) group can't delete
            // another group's messages via a forged h-tag mismatch.
            const refHTag = refEvent.tags.find((t) => t[0] === "h")?.[1];
            if (refHTag && refHTag !== groupId) continue;
            const refChannelTag = refEvent.tags.find((t) => t[0] === "channel")?.[1];
            const contextId = refChannelTag ? `${groupId}:${refChannelTag}` : groupId;
            store.dispatch(removeChatMessage({ contextId, eventId: tag[1] }));
            store.dispatch(hideMessage(tag[1]));
            store.dispatch(removeEvent(tag[1]));
            deleteEvent(tag[1]).catch(() => {});
          }
        }
      }
      putEvent(event).catch(() => {});
      break;
    }
  }

  // Index into active space feeds
  indexEventIntoSpaceFeeds(event);
}

/** Check if event author is a member of any active space and index accordingly */
function indexEventIntoSpaceFeeds(event: NostrEvent): void {
  // Early return: skip if event kind doesn't match any non-htag channel route
  if (!spaceFeedKinds.has(event.kind)) return;

  // Skip private/unlisted music events from space feeds — they should only appear
  // via direct access (library, collaborator views), not in shared space channels
  if (event.kind === EVENT_KINDS.MUSIC_TRACK || event.kind === EVENT_KINDS.MUSIC_ALBUM) {
    const hasPrivateTag = event.tags.some(
      (t) => t[0] === "visibility" && (t[1] === "private" || t[1] === "unlisted"),
    );
    if (hasPrivateTag) return;

    // When an addressable event replaces an older version (same pubkey+kind+d_tag),
    // remove the old event ID from all space feeds to prevent stale entries.
    // This happens when visibility changes (e.g., private → space).
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (dTag) {
      const addrId = `${event.kind}:${event.pubkey}:${dTag}`;
      const existingTrack = store.getState().music.tracks[addrId] ?? store.getState().music.albums[addrId.replace("31683:", "33123:")];
      if (existingTrack && existingTrack.eventId !== event.id) {
        store.dispatch(removeEventFromAllSpaceFeeds(existingTrack.eventId));
      }
    }
  }

  const state = store.getState();

  // Index into Friends Feed if active and author is in follow list
  if (state.spaces.activeSpaceId === "__friends_feed__") {
    const followList = state.identity.followList;
    if (followList.length > 0) {
      const followSet = getCachedSet("friends_feed", followList);
      if (followSet.has(event.pubkey)) {
        for (const [channelType, route] of Object.entries(SPACE_CHANNEL_ROUTES)) {
          if (route.filterMode === "htag") continue;
          if (!route.kinds.includes(event.kind)) continue;
          const contextId = `__friends_feed__:${channelType}`;
          emit(indexSpaceFeed({ contextId, eventId: event.id }));
          emit(trackFeedTimestamp({ contextId, createdAt: event.created_at }));
        }
        // Cross-index notes with media into media feed
        if (event.kind === EVENT_KINDS.SHORT_TEXT && (hasMediaUrls(event.content) || hasEmbedUrls(event.content))) {
          emit(indexSpaceFeed({ contextId: "__friends_feed__:media", eventId: event.id }));
          emit(trackFeedTimestamp({ contextId: "__friends_feed__:media", createdAt: event.created_at }));
        }
      }
    }
  }

  const spaces = state.spaces.list;
  if (spaces.length === 0) return;

  const channelsMap = state.spaces.channels;

  for (const space of spaces) {
    // For feed-mode spaces, index events from feed sources only;
    // for community spaces, index events from all members
    const authorPubkeys =
      space.mode === "read" ? space.feedPubkeys : space.memberPubkeys;
    const authorSet = getCachedSet(
      space.mode === "read" ? `feed:${space.id}` : space.id,
      authorPubkeys,
    );
    if (!authorSet.has(event.pubkey)) continue;

    // Space-scoped events (h-tag) should only index into their target space.
    // Without this check, a track with ["h", "space-A"] would leak into space-B
    // if the author is a member of both spaces.
    const eventHTag = event.tags.find((t) => t[0] === "h")?.[1];
    if (eventHTag && eventHTag !== space.id) continue;

    // Check which space channel this event kind belongs to
    for (const [channelType, route] of Object.entries(SPACE_CHANNEL_ROUTES)) {
      if (route.filterMode === "htag") continue; // Chat is h-tag scoped, not author-scoped
      if (!route.kinds.includes(event.kind)) continue;

      // Index with channel ID format if channels are loaded.
      // Use filter (not find) to support multiple channels of the same type (e.g. music).
      const spaceChannels = channelsMap[space.id];
      if (spaceChannels && spaceChannels.length > 0) {
        const matchingChannels = spaceChannels.filter((c) => c.type === channelType);
        const eventChannelTag = event.tags.find((t) => t[0] === "channel")?.[1];

        for (const ch of matchingChannels) {
          if (eventChannelTag) {
            // Event explicitly targets a specific channel — only index into that channel,
            // regardless of feed mode. A track tagged for #content should NOT also appear in #music.
            if (eventChannelTag !== ch.id) continue;
          } else if (ch.feedMode === "curated") {
            // Curated channels only accept explicitly tagged events
            continue;
          }
          // All-mode channels with no channel tag on the event: accept (default behavior)
          const contextId = `${space.id}:${ch.id}`;
          emit(indexSpaceFeed({ contextId, eventId: event.id }));
          emit(trackFeedTimestamp({ contextId, createdAt: event.created_at }));
        }
      }

      // Also index with legacy type-based format for selectors that use it
      const legacyContextId = `${space.id}:${channelType}`;
      emit(indexSpaceFeed({ contextId: legacyContextId, eventId: event.id }));
      emit(trackFeedTimestamp({ contextId: legacyContextId, createdAt: event.created_at }));
    }

    // Cross-index: kind:1 notes that contain media URLs or embed links also go into the media feed
    if (event.kind === EVENT_KINDS.SHORT_TEXT && (hasMediaUrls(event.content) || hasEmbedUrls(event.content))) {
      const spaceChannels = channelsMap[space.id];
      const mediaChannel = spaceChannels?.find((c) => c.type === "media");
      if (mediaChannel) {
        const contextId = `${space.id}:${mediaChannel.id}`;
        emit(indexSpaceFeed({ contextId, eventId: event.id }));
        emit(trackFeedTimestamp({ contextId, createdAt: event.created_at }));
      }
      // Also legacy format
      const legacyMediaContextId = `${space.id}:media`;
      emit(indexSpaceFeed({ contextId: legacyMediaContextId, eventId: event.id }));
      emit(trackFeedTimestamp({ contextId: legacyMediaContextId, createdAt: event.created_at }));
    }
  }
}

/** Validate that a string is a 64-character hex pubkey */
const HEX64_RE = /^[0-9a-f]{64}$/i;

/** Handle incoming gift wrap (kind:1059) — decrypt and route to DM or friend request */
async function handleGiftWrap(event: NostrEvent): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey) return;

  // Only process wraps addressed to us. Recipient wraps from our own sends
  // bounce back from relays but can't be decrypted — some NIP-07 extensions
  // return garbage instead of throwing, creating ghost DM conversations.
  const recipientTag = event.tags.find((t) => t[0] === "p")?.[1];
  if (recipientTag && recipientTag !== myPubkey) return;

  try {
    const dm = await unwrapGiftWrap(event);

    // Validate unwrapped data — guard against corrupted decryptions from
    // wraps not addressed to us (some NIP-07 extensions don't throw on
    // wrong-key decryption, returning garbage that may survive JSON.parse)
    if (!dm.sender || !HEX64_RE.test(dm.sender) || !Array.isArray(dm.tags)) {
      return;
    }

    // Check for friend request type tags before DM routing
    const typeTag = dm.tags.find((t) => t[0] === "type")?.[1];
    if (typeTag === "friend_request") {
      handleFriendRequestWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "friend_request_accept") {
      handleFriendAcceptWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "friend_request_remove") {
      handleFriendRemoveWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "call_invite") {
      handleCallInviteWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "call_decline") {
      handleCallDeclineWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "call_missed") {
      handleCallMissedWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "dm_edit") {
      handleDMEditWrap(dm, myPubkey);
      return;
    }
    if (typeTag === "dm_delete") {
      handleDMDeleteWrap(dm, myPubkey);
      return;
    }

    const isOwnMessage = dm.sender === myPubkey;

    // Determine conversation partner
    const partnerPubkey = isOwnMessage
      ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
      : dm.sender;

    // Reject if partner pubkey is invalid (corrupted decryption artifact)
    if (!HEX64_RE.test(partnerPubkey) || (partnerPubkey === myPubkey && !isOwnMessage)) {
      return;
    }

    // Snapshot DM state BEFORE dispatch so we can gate the notification on
    // whether this wrap was already processed (e.g. restored from IndexedDB).
    const dmState = store.getState().dm;
    const alreadyProcessed = !!dmState.processedWrapIdSet[dm.wrapId];

    // NIP-17: the rumor's created_at IS the real send time.
    // Only the seal and gift wrap timestamps are randomized for privacy.
    const displayTimestamp = dm.createdAt;

    // Extract reply reference from q-tag (if this is a reply)
    const replyToWrapId = dm.tags.find((t) => t[0] === "q")?.[1];

    // Extract NIP-30 emoji tags for custom emoji rendering
    const dmEmojiTags = dm.tags.filter((t) => t[0] === "emoji");

    store.dispatch(
      addDMMessage({
        partnerPubkey,
        myPubkey,
        message: {
          id: dm.wrapId,
          senderPubkey: dm.sender,
          content: dm.content,
          createdAt: displayTimestamp,
          wrapId: dm.wrapId,
          rumorId: dm.rumorId,
          replyToWrapId,
          emojiTags: dmEmojiTags.length > 0 ? dmEmojiTags : undefined,
        },
      }),
    );

    // Only fire notification for genuinely new incoming messages that we're
    // not currently viewing. Prevents spurious notifications on app reload
    // when old wraps are re-fetched from relays.
    if (!isOwnMessage && !alreadyProcessed && dmState.activeConversation !== partnerPubkey) {
      evaluateDMNotification(dm.sender, dm.content);
    }
  } catch {
    // Decryption failed — common for wraps not addressed to us
  }
}

/** Handle an unwrapped friend request */
function handleFriendRequestWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  const partnerPubkey = isOwnMessage
    ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
    : dm.sender;

  const frState = store.getState().friendRequests;

  // Dedup check
  if (frState.processedWrapIds.includes(dm.wrapId)) return;

  // Skip relay resurrection of OLD self-wraps (our own outgoing requests from before removal).
  // But if this is an INCOMING request (someone actively sending us a new request),
  // clear them from removedPubkeys and process it — they want to re-friend.
  if (frState.removedPubkeys.includes(partnerPubkey)) {
    if (isOwnMessage) return;
    store.dispatch(clearRemovedPubkey(partnerPubkey));
  }

  // NOTE: Do NOT dispatch addProcessedWrapId here — the addFriendRequest reducer
  // handles ID tracking internally. Dispatching it separately would preempt the
  // reducer's dedup check and cause it to short-circuit without adding the request.

  const direction = isOwnMessage ? "outgoing" : "incoming";

  // Auto-accept: if we receive an incoming request and we already have a pending
  // outgoing to the same pubkey, auto-accept both directions
  if (direction === "incoming") {
    const pendingOutgoing = frState.requests.find(
      (r) => r.pubkey === partnerPubkey && r.direction === "outgoing" && r.status === "pending",
    );
    if (pendingOutgoing) {
      store.dispatch(
        addFriendRequest({
          id: dm.wrapId,
          pubkey: partnerPubkey,
          message: dm.content,
          createdAt: Math.round(Date.now() / 1000),
          status: "accepted",
          direction: "incoming",
        }),
      );
      store.dispatch(markOutgoingAccepted(partnerPubkey));
      store.dispatch(addKnownFollower(partnerPubkey));
      // Send accept back (don't duplicate the state updates already done above)
      acceptFriendRequestAction(partnerPubkey).catch(() => {});
      return;
    }
  }

  store.dispatch(
    addFriendRequest({
      id: dm.wrapId,
      pubkey: partnerPubkey,
      message: dm.content,
      createdAt: Math.round(Date.now() / 1000),
      status: "pending",
      direction,
    }),
  );

  // Fire notification for incoming only
  if (direction === "incoming") {
    evaluateFriendRequestNotification(partnerPubkey, dm.content);
  }
}

/** Handle an unwrapped friend request accept */
function handleFriendAcceptWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  const partnerPubkey = isOwnMessage
    ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
    : dm.sender;

  const frState = store.getState().friendRequests;

  // Dedup check
  if (frState.processedWrapIds.includes(dm.wrapId)) return;

  // Track wrap ID to prevent re-processing (was previously missing)
  store.dispatch(addProcessedWrapId(dm.wrapId));

  // For incoming accepts: if they're accepting our request, clear from removed list.
  // For own self-wraps of old accepts: skip if partner was removed (relay resurrection).
  if (frState.removedPubkeys.includes(partnerPubkey)) {
    if (isOwnMessage) {
      return;
    }
    store.dispatch(clearRemovedPubkey(partnerPubkey));
  }

  if (!isOwnMessage) {
    // They accepted our request
    store.dispatch(markOutgoingAccepted(partnerPubkey));
    store.dispatch(acceptFriendRequest(partnerPubkey));
    // They accepted, so they follow us — sync knownFollowers
    store.dispatch(addKnownFollower(partnerPubkey));
    // Auto-follow: friendship implies mutual following.
    // acceptFriendRequestAction handles this for the accepting side,
    // but the sender also needs to follow back when the accept arrives.
    const currentFollows = store.getState().identity.followList;
    if (!currentFollows.includes(partnerPubkey)) {
      followUser(partnerPubkey).catch((err) => {
        console.error("[FriendReq] Auto-follow on accept receipt failed:", err);
      });
    }
    evaluateFriendAcceptNotification(partnerPubkey);
  }
}

/** Handle an unwrapped friend removal notification */
function handleFriendRemoveWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  const partnerPubkey = isOwnMessage
    ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
    : dm.sender;

  const frState = store.getState().friendRequests;

  // Dedup check
  if (frState.processedWrapIds.includes(dm.wrapId)) return;
  store.dispatch(addProcessedWrapId(dm.wrapId));

  if (!isOwnMessage) {
    // The other user removed us as a friend — clear all request state for them
    store.dispatch(removeFriend(partnerPubkey));
  }
}

/**
 * Calls use persistent gift wraps (kind:1059) for signalling because ephemeral
 * kinds aren't available for E2E-encrypted DMs. Relays keep those wraps forever,
 * so every client reconnect replays them. A call is only valid for seconds, so
 * anything older than this window is stale noise — suppress it.
 */
const CALL_WRAP_MAX_AGE_SEC = 60;

function isCallWrapFresh(createdAt: number | undefined): boolean {
  if (typeof createdAt !== "number") return false;
  const nowSec = Math.round(Date.now() / 1000);
  return nowSec - createdAt <= CALL_WRAP_MAX_AGE_SEC;
}

/** Handle an incoming call invitation from a gift wrap */
function handleCallInviteWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string; createdAt?: number },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  if (isOwnMessage) return; // Ignore our own outgoing invites

  const callState = store.getState().call;

  // Dedup: never re-ring on the same wrap (survives reload / user switch via IDB).
  if (callState.processedWrapIds.includes(dm.wrapId)) return;
  store.dispatch(addProcessedCallWrapId(dm.wrapId));

  // Drop stale invites resurfaced from relay storage on reconnect.
  if (!isCallWrapFresh(dm.createdAt)) return;

  // Don't accept calls if we already have an active call
  if (callState.activeCall || callState.incomingCall) return;

  try {
    const payload = JSON.parse(dm.content) as {
      roomSecretKey: string;
      callType: CallType;
      callerName: string;
    };

    console.log(`[call] incoming invite from=${dm.sender.slice(0, 8)} type=${payload.callType}`);

    store.dispatch(
      setIncomingCall({
        callerPubkey: dm.sender,
        roomSecretKey: payload.roomSecretKey,
        callType: payload.callType,
        callerName: payload.callerName,
        timestamp: Date.now(),
      }),
    );
  } catch {
    console.warn("[call] Failed to parse call invite");
  }
}

/** Handle a call decline notification — the remote party declined our outgoing call */
function handleCallDeclineWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string; createdAt?: number },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  if (isOwnMessage) return;

  const callState = store.getState().call;
  if (callState.processedWrapIds.includes(dm.wrapId)) return;
  store.dispatch(addProcessedCallWrapId(dm.wrapId));
  if (!isCallWrapFresh(dm.createdAt)) return;

  if (callState.activeCall?.partnerPubkey === dm.sender) {
    store.dispatch(endCall("declined"));
  }
}

/** Handle a missed call notification */
function handleCallMissedWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string; createdAt?: number },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  if (isOwnMessage) return;

  const callState = store.getState().call;
  if (callState.processedWrapIds.includes(dm.wrapId)) return;
  store.dispatch(addProcessedCallWrapId(dm.wrapId));
  if (!isCallWrapFresh(dm.createdAt)) return;

  if (callState.incomingCall?.callerPubkey === dm.sender) {
    store.dispatch(missedCall());
  }
}

/** Handle an incoming DM edit from a gift wrap */
function handleDMEditWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  const partnerPubkey = isOwnMessage
    ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
    : dm.sender;

  const originalRumorId = dm.tags.find((t) => t[0] === "e")?.[1];
  if (!originalRumorId || !HEX64_RE.test(partnerPubkey)) return;

  store.dispatch(
    editDMMessage({
      partnerPubkey,
      rumorId: originalRumorId,
      newContent: dm.content,
      editedAt: Math.round(Date.now() / 1000),
      senderPubkey: dm.sender,
      wrapId: dm.wrapId,
    }),
  );
}

/** Handle an incoming DM delete from a gift wrap */
function handleDMDeleteWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  const partnerPubkey = isOwnMessage
    ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
    : dm.sender;

  const originalRumorId = dm.tags.find((t) => t[0] === "e")?.[1];
  if (!originalRumorId || !HEX64_RE.test(partnerPubkey)) return;

  store.dispatch(
    remoteDeleteDMMessage({
      partnerPubkey,
      rumorId: originalRumorId,
      senderPubkey: dm.sender,
      wrapId: dm.wrapId,
    }),
  );
}

/** Handle an incoming WebRTC signaling event (kind:25050) */
async function handleWebRTCSignal(event: NostrEvent): Promise<void> {
  const myPubkey = store.getState().identity.pubkey;
  if (!myPubkey || event.pubkey === myPubkey) return;

  // Only process signals addressed to us
  const recipientTag = event.tags.find((t) => t[0] === "p")?.[1];
  if (recipientTag && recipientTag !== myPubkey) return;

  try {
    const signal = await parseRTCSignal(event);
    if (!signal) return;

    // Dynamically import to avoid circular dependencies
    const { handleRTCSignal } = await import("../../features/calling/callService");
    handleRTCSignal(signal);
  } catch (err) {
    console.debug("[webrtc] Signal processing failed:", (err as Error)?.message ?? err);
  }
}
