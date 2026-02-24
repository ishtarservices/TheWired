import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { EventDeduplicator } from "./dedup";
import { isValidEventStructure } from "./validation";
import { verifyBridge } from "./verifyWorkerBridge";
import { store } from "../../store";
import { putEvent } from "../db/eventStore";
import { addEvent, indexChatMessage, indexReel, indexLongForm, indexLiveStream, indexNote, indexSpaceFeed, indexMusicTrack, indexMusicAlbum } from "../../store/slices/eventsSlice";
import { addTrack, indexTrackByArtist, indexTrackByAlbum, addAlbum, addPlaylist } from "../../store/slices/musicSlice";
import { parseTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { incrementEventCount } from "../../store/slices/relaysSlice";
import { trackFeedTimestamp } from "../../store/slices/feedSlice";
import { SPACE_CHANNEL_ROUTES } from "../../features/spaces/spaceChannelRoutes";
import { hasMediaUrls } from "../media/mediaUrlParser";

const dedup = new EventDeduplicator();

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

  // Step 4b: Persist addressable events to IndexedDB (music, longform, etc.)
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
  const spaces = store.getState().spaces.list;
  if (spaces.length === 0) return;

  for (const space of spaces) {
    if (!space.memberPubkeys.includes(event.pubkey)) continue;

    // Check which space channel this event kind belongs to
    for (const [channelType, route] of Object.entries(SPACE_CHANNEL_ROUTES)) {
      if (route.filterMode === "htag") continue; // Chat is h-tag scoped, not author-scoped
      if (!route.kinds.includes(event.kind)) continue;

      const contextId = `${space.id}:${channelType}`;
      store.dispatch(indexSpaceFeed({ contextId, eventId: event.id }));
      store.dispatch(trackFeedTimestamp({ contextId, createdAt: event.created_at }));
    }

    // Cross-index: kind:1 notes that contain media URLs also go into the media feed
    if (event.kind === EVENT_KINDS.SHORT_TEXT && hasMediaUrls(event.content)) {
      const mediaContextId = `${space.id}:media`;
      store.dispatch(indexSpaceFeed({ contextId: mediaContextId, eventId: event.id }));
      store.dispatch(trackFeedTimestamp({ contextId: mediaContextId, createdAt: event.created_at }));
    }
  }
}
