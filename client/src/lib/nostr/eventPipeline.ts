import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { EventDeduplicator } from "./dedup";
import { isValidEventStructure } from "./validation";
import { verifyBridge } from "./verifyWorkerBridge";
import { store } from "../../store";
import { putEvent } from "../db/eventStore";
import { addEvent, indexChatMessage, indexReel, indexLongForm, indexLiveStream, indexNote, indexSpaceFeed, indexMusicTrack, indexMusicAlbum, indexReaction, indexReply, indexRepost, indexQuote } from "../../store/slices/eventsSlice";
import { addTrack, indexTrackByArtist, indexTrackByAlbum, addAlbum, addPlaylist } from "../../store/slices/musicSlice";
import { parseTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { incrementEventCount } from "../../store/slices/relaysSlice";
import { trackFeedTimestamp } from "../../store/slices/feedSlice";
import { SPACE_CHANNEL_ROUTES } from "../../features/spaces/spaceChannelRoutes";
import { hasMediaUrls } from "../media/mediaUrlParser";
import { parseThreadRef, parseQuoteRef } from "../../features/spaces/noteParser";
import { profileCache } from "./profileCache";

const dedup = new EventDeduplicator();

// Cached Set for space member lookups (O(1) instead of O(n) per check)
const memberSetCache = new Map<string, { set: Set<string>; fingerprint: string }>();

/** Get or create a cached Set from a space's memberPubkeys array */
function getMemberSet(spaceId: string, memberPubkeys: string[]): Set<string> {
  // Cheap fingerprint: length + first + last pubkey
  const fingerprint = `${memberPubkeys.length}:${memberPubkeys[0] ?? ""}:${memberPubkeys[memberPubkeys.length - 1] ?? ""}`;
  const cached = memberSetCache.get(spaceId);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.set;
  }
  const set = new Set(memberPubkeys);
  memberSetCache.set(spaceId, { set, fingerprint });
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
 * 1. Dedup check (bloom + LRU)
 * 2. Structural validation
 * 3. Signature verification (Web Worker)
 * 4. Dispatch to Redux + index
 */
export async function processIncomingEvent(
  event: unknown,
  relayUrl: string,
): Promise<void> {
  // Step 1: Structural validation (fast, sync)
  if (!isValidEventStructure(event)) return;

  // Step 2: Dedup
  if (dedup.isDuplicate(event.id)) return;
  dedup.markSeen(event.id);

  // Step 3: Signature verification (Web Worker, async)
  try {
    const valid = await verifyBridge.verify(event);
    if (!valid) return;
  } catch {
    // Verification failed or timed out
    return;
  }

  // Step 4: Dispatch to store
  store.dispatch(addEvent(event));
  store.dispatch(incrementEventCount(relayUrl));

  // Step 4b: Wire kind:0 events into the profile cache
  if (event.kind === EVENT_KINDS.METADATA) {
    profileCache.handleProfileEvent(event);
  }

  // Step 4c: Persist addressable events to IndexedDB (music, longform, etc.)
  // so they survive page refresh
  if (event.kind >= 30000 && event.kind < 40000) {
    putEvent(event).catch(() => {/* best-effort persistence */});
  }

  // Step 5: Index by kind
  indexEvent(event);
}

function indexEvent(event: NostrEvent): void {
  const hTag = event.tags.find((t) => t[0] === "h")?.[1];

  switch (event.kind) {
    case EVENT_KINDS.SHORT_TEXT: {
      store.dispatch(
        indexNote({ pubkey: event.pubkey, eventId: event.id }),
      );
      // Index as reply if it has thread references
      const threadRef = parseThreadRef(event);
      if (threadRef.rootId) {
        store.dispatch(indexReply({ parentEventId: threadRef.rootId, eventId: event.id }));
        if (threadRef.replyId && threadRef.replyId !== threadRef.rootId) {
          store.dispatch(indexReply({ parentEventId: threadRef.replyId, eventId: event.id }));
        }
      }
      // Index as quote if it has a "q" tag
      const quoteRef = parseQuoteRef(event);
      if (quoteRef) {
        store.dispatch(indexQuote({ targetEventId: quoteRef.eventId, eventId: event.id }));
      }
      break;
    }
    case EVENT_KINDS.REACTION: {
      // NIP-25: last "e" tag is the target event
      const lastETag = [...event.tags].reverse().find((t) => t[0] === "e");
      if (lastETag?.[1]) {
        store.dispatch(indexReaction({ targetEventId: lastETag[1], eventId: event.id }));
      }
      break;
    }
    case EVENT_KINDS.REPOST: {
      const eTag = event.tags.find((t) => t[0] === "e");
      if (eTag?.[1]) {
        store.dispatch(indexRepost({ targetEventId: eTag[1], eventId: event.id }));
      }
      break;
    }
    case EVENT_KINDS.CHAT_MESSAGE: {
      if (hTag) {
        store.dispatch(indexChatMessage({ groupId: hTag, eventId: event.id }));
        store.dispatch(trackFeedTimestamp({ contextId: hTag, createdAt: event.created_at }));
      }
      break;
    }
    case EVENT_KINDS.VIDEO_VERTICAL:
    case EVENT_KINDS.VIDEO_VERTICAL_ADDR: {
      const contextId = hTag ?? "global";
      store.dispatch(indexReel({ contextId, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.LONG_FORM: {
      const contextId = hTag ?? "global";
      store.dispatch(indexLongForm({ contextId, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.LIVE_STREAM: {
      const contextId = hTag ?? "global";
      store.dispatch(indexLiveStream({ contextId, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.MUSIC_TRACK: {
      const contextId = hTag ?? "global";
      store.dispatch(indexMusicTrack({ contextId, eventId: event.id }));
      const track = parseTrackEvent(event);
      store.dispatch(addTrack(track));
      store.dispatch(indexTrackByArtist({ pubkey: event.pubkey, addressableId: track.addressableId }));
      // Also index by each featured artist
      for (const fp of track.featuredArtists) {
        store.dispatch(indexTrackByArtist({ pubkey: fp, addressableId: track.addressableId }));
      }
      if (track.albumRef) {
        store.dispatch(indexTrackByAlbum({ albumAddrId: track.albumRef, trackAddrId: track.addressableId }));
      }
      break;
    }
    case EVENT_KINDS.MUSIC_ALBUM: {
      const contextId = hTag ?? "global";
      store.dispatch(indexMusicAlbum({ contextId, eventId: event.id }));
      const album = parseAlbumEvent(event);
      store.dispatch(addAlbum(album));
      break;
    }
    case EVENT_KINDS.MUSIC_PLAYLIST: {
      const playlist = parsePlaylistEvent(event);
      store.dispatch(addPlaylist(playlist));
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

  const state = store.getState();
  const spaces = state.spaces.list;
  if (spaces.length === 0) return;

  const channelsMap = state.spaces.channels;

  for (const space of spaces) {
    // O(1) Set lookup instead of O(n) Array.includes
    const memberSet = getMemberSet(space.id, space.memberPubkeys);
    if (!memberSet.has(event.pubkey)) continue;

    // Check which space channel this event kind belongs to
    for (const [channelType, route] of Object.entries(SPACE_CHANNEL_ROUTES)) {
      if (route.filterMode === "htag") continue; // Chat is h-tag scoped, not author-scoped
      if (!route.kinds.includes(event.kind)) continue;

      // Index with channel ID format if channels are loaded
      const spaceChannels = channelsMap[space.id];
      if (spaceChannels && spaceChannels.length > 0) {
        const matchingChannel = spaceChannels.find((c) => c.type === channelType);
        if (matchingChannel) {
          const contextId = `${space.id}:${matchingChannel.id}`;
          store.dispatch(indexSpaceFeed({ contextId, eventId: event.id }));
          store.dispatch(trackFeedTimestamp({ contextId, createdAt: event.created_at }));
        }
      }

      // Also index with legacy type-based format for selectors that use it
      const legacyContextId = `${space.id}:${channelType}`;
      store.dispatch(indexSpaceFeed({ contextId: legacyContextId, eventId: event.id }));
      store.dispatch(trackFeedTimestamp({ contextId: legacyContextId, createdAt: event.created_at }));
    }

    // Cross-index: kind:1 notes that contain media URLs also go into the media feed
    if (event.kind === EVENT_KINDS.SHORT_TEXT && hasMediaUrls(event.content)) {
      const spaceChannels = channelsMap[space.id];
      const mediaChannel = spaceChannels?.find((c) => c.type === "media");
      if (mediaChannel) {
        const contextId = `${space.id}:${mediaChannel.id}`;
        store.dispatch(indexSpaceFeed({ contextId, eventId: event.id }));
        store.dispatch(trackFeedTimestamp({ contextId, createdAt: event.created_at }));
      }
      // Also legacy format
      const legacyMediaContextId = `${space.id}:media`;
      store.dispatch(indexSpaceFeed({ contextId: legacyMediaContextId, eventId: event.id }));
      store.dispatch(trackFeedTimestamp({ contextId: legacyMediaContextId, createdAt: event.created_at }));
    }
  }
}
