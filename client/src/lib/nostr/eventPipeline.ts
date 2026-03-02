import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { EventDeduplicator } from "./dedup";
import { isValidEventStructure } from "./validation";
import { verifyBridge } from "./verifyWorkerBridge";
import { store } from "../../store";
import { putEvent } from "../db/eventStore";
import { addEvent, indexChatMessage, indexReel, indexLongForm, indexLiveStream, indexNote, indexSpaceFeed, indexMusicTrack, indexMusicAlbum, indexReaction, indexReply, indexRepost, indexQuote } from "../../store/slices/eventsSlice";
import { addTrack, indexTrackByArtist, indexTrackByAlbum, addAlbum, addPlaylist } from "../../store/slices/musicSlice";
import { addDMMessage } from "../../store/slices/dmSlice";
import { parseTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { incrementEventCount } from "../../store/slices/relaysSlice";
import { trackFeedTimestamp } from "../../store/slices/feedSlice";
import { SPACE_CHANNEL_ROUTES } from "../../features/spaces/spaceChannelRoutes";
import { hasMediaUrls } from "../media/mediaUrlParser";
import { parseThreadRef, parseQuoteRef } from "../../features/spaces/noteParser";
import { profileCache } from "./profileCache";
import { unwrapGiftWrap } from "./giftWrap";
import { evaluateNotification, evaluateDMNotification, evaluateFriendRequestNotification, evaluateFriendAcceptNotification } from "./notificationEvaluator";
import { addFriendRequest, markOutgoingAccepted, acceptFriendRequest, addProcessedWrapId, removeFriend } from "../../store/slices/friendRequestSlice";
import { addKnownFollower } from "../../store/slices/identitySlice";
import { acceptFriendRequestAction } from "./friendRequest";

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

  // Step 4: Handle gift wraps specially (don't add to general event store)
  if (event.kind === EVENT_KINDS.GIFT_WRAP) {
    store.dispatch(incrementEventCount(relayUrl));
    handleGiftWrap(event);
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

  // Step 6: Evaluate for notifications (unread badges, toasts)
  evaluateNotification(event);
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
        const channelTag = event.tags.find((t) => t[0] === "channel")?.[1];

        if (channelTag) {
          // New-style: explicit channel tag → index per-channel
          const indexKey = `${hTag}:${channelTag}`;
          store.dispatch(indexChatMessage({ groupId: indexKey, eventId: event.id }));
          store.dispatch(trackFeedTimestamp({ contextId: indexKey, createdAt: event.created_at }));
        } else {
          // Legacy: no channel tag → route to default chat channel if known
          const state = store.getState();
          const spaceChannels = state.spaces.channels[hTag];
          const defaultChat = spaceChannels?.find((c) => c.type === "chat" && c.isDefault)
            ?? spaceChannels?.find((c) => c.type === "chat");

          if (defaultChat) {
            const indexKey = `${hTag}:${defaultChat.id}`;
            store.dispatch(indexChatMessage({ groupId: indexKey, eventId: event.id }));
            store.dispatch(trackFeedTimestamp({ contextId: indexKey, createdAt: event.created_at }));
          } else {
            // Channels not loaded yet — fall back to space-level indexing
            store.dispatch(indexChatMessage({ groupId: hTag, eventId: event.id }));
            store.dispatch(trackFeedTimestamp({ contextId: hTag, createdAt: event.created_at }));
          }
        }
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

/** Handle incoming gift wrap (kind:1059) — decrypt and route to DM or friend request */
async function handleGiftWrap(event: NostrEvent): Promise<void> {
  try {
    const dm = await unwrapGiftWrap(event);
    const myPubkey = store.getState().identity.pubkey;
    if (!myPubkey) return;

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

    const isOwnMessage = dm.sender === myPubkey;

    // Determine conversation partner
    const partnerPubkey = isOwnMessage
      ? dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender
      : dm.sender;

    // Snapshot DM state BEFORE dispatch so we can gate the notification on
    // whether this wrap was already processed (e.g. restored from IndexedDB).
    const dmState = store.getState().dm;
    const alreadyProcessed = dmState.processedWrapIds.includes(dm.wrapId);

    // Use receive-time for display instead of the rumor's randomized created_at.
    // NIP-17 randomizes the rumor timestamp for wire-level privacy — it's not
    // meaningful for display. Own messages dispatched from dmService already use
    // real time and will dedup before reaching here.
    const displayTimestamp = Math.round(Date.now() / 1000);

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
        },
      }),
    );

    // Only fire notification for genuinely new incoming messages that we're
    // not currently viewing. Prevents spurious notifications on app reload
    // when old wraps are re-fetched from relays.
    if (!isOwnMessage && !alreadyProcessed && dmState.activeConversation !== partnerPubkey) {
      evaluateDMNotification(dm.sender, dm.content);
    }
  } catch (err) {
    // Log for debugging — common for wraps not addressed to us
    console.debug("[DM] Gift wrap decryption failed:", (err as Error)?.message ?? err);
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

  // Skip if this pubkey was explicitly removed/cancelled — prevents relay resurrection
  if (frState.removedPubkeys.includes(partnerPubkey)) return;

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

  // Skip if this pubkey was explicitly removed
  if (frState.removedPubkeys.includes(partnerPubkey)) return;

  if (!isOwnMessage) {
    // They accepted our request
    store.dispatch(markOutgoingAccepted(partnerPubkey));
    store.dispatch(acceptFriendRequest(partnerPubkey));
    // They accepted, so they follow us — sync knownFollowers
    store.dispatch(addKnownFollower(partnerPubkey));
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
