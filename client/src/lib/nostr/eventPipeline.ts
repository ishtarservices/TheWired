import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import { EventDeduplicator } from "./dedup";
import { isValidEventStructure } from "./validation";
import { verifyBridge } from "./verifyWorkerBridge";
import { store } from "../../store";
import { putEvent, deleteEvent } from "../db/eventStore";
import { addEvent, indexChatMessage, indexReel, indexLongForm, indexLiveStream, indexNote, indexSpaceFeed, indexMusicTrack, indexMusicAlbum, indexReaction, indexReply, indexRepost, indexRepostByAuthor, indexQuote, removeChatMessage, hideMessage, removeEvent, indexEditedMessage } from "../../store/slices/eventsSlice";
import { addTrack, indexTrackByArtist, indexTrackByAlbum, indexTrackByArtistName, indexAlbumByArtist, indexAlbumByArtistName, addAlbum, addPlaylist, addAnnotation, removeAnnotation, removeTrack, removeAlbum, removePlaylist } from "../../store/slices/musicSlice";
import { addDMMessage, editDMMessage, remoteDeleteDMMessage } from "../../store/slices/dmSlice";
import { parseTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { parseAnnotationEvent } from "../../features/music/annotationParser";
import { incrementEventCount } from "../../store/slices/relaysSlice";
import { trackFeedTimestamp } from "../../store/slices/feedSlice";
import { SPACE_CHANNEL_ROUTES } from "../../features/spaces/spaceChannelRoutes";
import { hasMediaUrls, hasEmbedUrls } from "../media/mediaUrlParser";
import { parseThreadRef, parseQuoteRef } from "../../features/spaces/noteParser";
import { profileCache } from "./profileCache";
import { unwrapGiftWrap } from "./giftWrap";
import { evaluateNotification, evaluateDMNotification, evaluateFriendRequestNotification, evaluateFriendAcceptNotification } from "./notificationEvaluator";
import { addFriendRequest, markOutgoingAccepted, acceptFriendRequest, addProcessedWrapId, removeFriend } from "../../store/slices/friendRequestSlice";
import { addKnownFollower } from "../../store/slices/identitySlice";
import { acceptFriendRequestAction } from "./friendRequest";
import { setIncomingCall, missedCall, endCall } from "../../store/slices/callSlice";
import { parseRTCSignal } from "./callSignaling";
import type { CallType } from "../../types/calling";

const dedup = new EventDeduplicator();

// Cached Set for space author lookups (O(1) instead of O(n) per check)
const authorSetCache = new Map<string, { set: Set<string>; fingerprint: string }>();

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

  // Handle WebRTC signaling events (kind:25050) — ephemeral, don't store
  if (event.kind === EVENT_KINDS.WEBRTC_SIGNAL) {
    store.dispatch(incrementEventCount(relayUrl));
    handleWebRTCSignal(event);
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
      store.dispatch(indexRepostByAuthor({ pubkey: event.pubkey, eventId: event.id }));
      break;
    }
    case EVENT_KINDS.CHAT_MESSAGE: {
      // Check if this is an edit event (has ["e", ..., "edit"] tag)
      const editTag = event.tags.find((t) => t[0] === "e" && t[3] === "edit");
      if (editTag?.[1]) {
        const originalId = editTag[1];
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
      // Index by artist pubkeys
      if (track.artistPubkeys.length > 0) {
        for (const pk of track.artistPubkeys) {
          store.dispatch(indexTrackByArtist({ pubkey: pk, addressableId: track.addressableId }));
        }
      } else if (track.artist && track.artist !== event.pubkey) {
        // Text-only artist (no npub linked) — index by normalized name
        store.dispatch(indexTrackByArtistName({ normalizedName: track.artist.toLowerCase().trim(), addressableId: track.addressableId }));
      } else {
        // Legacy fallback: uploader is the artist
        store.dispatch(indexTrackByArtist({ pubkey: event.pubkey, addressableId: track.addressableId }));
      }
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
      // Index by artist pubkeys
      if (album.artistPubkeys.length > 0) {
        for (const pk of album.artistPubkeys) {
          store.dispatch(indexAlbumByArtist({ pubkey: pk, addressableId: album.addressableId }));
        }
      } else if (album.artist && album.artist !== event.pubkey) {
        store.dispatch(indexAlbumByArtistName({ normalizedName: album.artist.toLowerCase().trim(), addressableId: album.addressableId }));
      } else {
        store.dispatch(indexAlbumByArtist({ pubkey: event.pubkey, addressableId: album.addressableId }));
      }
      // Also index by each featured artist
      for (const fp of album.featuredArtists) {
        store.dispatch(indexAlbumByArtist({ pubkey: fp, addressableId: album.addressableId }));
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
      const state = store.getState();
      for (const tag of event.tags) {
        if (tag[0] === "a" && tag[1]) {
          const addr = tag[1];
          const [kindStr, addrPubkey] = addr.split(":");
          if (addrPubkey !== event.pubkey) continue;
          const kind = parseInt(kindStr, 10);
          if (kind === EVENT_KINDS.MUSIC_TRACK) {
            const track = state.music.tracks[addr];
            // Only delete if the track was created before the deletion event
            if (track && track.createdAt <= event.created_at) {
              deleteEvent(track.eventId).catch(() => {});
              store.dispatch(removeTrack(addr));
            }
          } else if (kind === EVENT_KINDS.MUSIC_ALBUM) {
            const album = state.music.albums[addr];
            if (album && album.createdAt <= event.created_at) {
              deleteEvent(album.eventId).catch(() => {});
              store.dispatch(removeAlbum(addr));
            }
          } else if (kind === EVENT_KINDS.MUSIC_PLAYLIST) {
            const playlist = state.music.playlists[addr];
            if (playlist && playlist.createdAt <= event.created_at) {
              deleteEvent(playlist.eventId).catch(() => {});
              store.dispatch(removePlaylist(addr));
            }
          } else if (kind === EVENT_KINDS.MUSIC_TRACK_NOTES) {
            // Find and remove matching annotation
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
          const refEvent = state.events.entities[tag[1]];
          if (!refEvent || refEvent.pubkey === event.pubkey) {
            deleteEvent(tag[1]).catch(() => {});
            // If this was a kind:9 chat message, remove from chat index + hide
            if (refEvent?.kind === EVENT_KINDS.CHAT_MESSAGE) {
              const refHTag = refEvent.tags.find((t) => t[0] === "h")?.[1];
              if (refHTag) {
                const refChannelTag = refEvent.tags.find((t) => t[0] === "channel")?.[1];
                const contextId = refChannelTag ? `${refHTag}:${refChannelTag}` : refHTag;
                store.dispatch(removeChatMessage({ contextId, eventId: tag[1] }));
              }
              store.dispatch(hideMessage(tag[1]));
              store.dispatch(removeEvent(tag[1]));
            }
          }
        }
      }
      // Persist the deletion event itself so we can check on next startup
      putEvent(event).catch(() => {});
      break;
    }
    case EVENT_KINDS.MOD_DELETE_EVENT: {
      // NIP-29 kind:9005: moderator delete — admin removes a message from the group
      const groupId = event.tags.find((t) => t[0] === "h")?.[1];
      if (!groupId) break;
      for (const tag of event.tags) {
        if (tag[0] === "e" && tag[1]) {
          const refEvent = store.getState().events.entities[tag[1]];
          if (refEvent) {
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

  const state = store.getState();
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

    // Cross-index: kind:1 notes that contain media URLs or embed links also go into the media feed
    if (event.kind === EVENT_KINDS.SHORT_TEXT && (hasMediaUrls(event.content) || hasEmbedUrls(event.content))) {
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

    // Use receive-time for display instead of the rumor's randomized created_at.
    // NIP-17 randomizes the rumor timestamp for wire-level privacy — it's not
    // meaningful for display. Own messages dispatched from dmService already use
    // real time and will dedup before reaching here.
    const displayTimestamp = Math.round(Date.now() / 1000);

    // Extract reply reference from q-tag (if this is a reply)
    const replyToWrapId = dm.tags.find((t) => t[0] === "q")?.[1];

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

/** Handle an incoming call invitation from a gift wrap */
function handleCallInviteWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  if (isOwnMessage) return; // Ignore our own outgoing invites

  // Don't accept calls if we already have an active call
  const callState = store.getState().call;
  if (callState.activeCall || callState.incomingCall) return;

  try {
    const payload = JSON.parse(dm.content) as {
      roomSecretKey: string;
      callType: CallType;
      callerName: string;
    };

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
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  if (isOwnMessage) return;

  const callState = store.getState().call;
  if (callState.activeCall?.partnerPubkey === dm.sender) {
    store.dispatch(endCall("declined"));
  }
}

/** Handle a missed call notification */
function handleCallMissedWrap(
  dm: { sender: string; content: string; tags: string[][]; wrapId: string },
  myPubkey: string,
): void {
  const isOwnMessage = dm.sender === myPubkey;
  if (isOwnMessage) return;

  const callState = store.getState().call;
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
