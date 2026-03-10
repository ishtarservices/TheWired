import { store } from "../../store";
import {
  login,
  setProfile,
  setRelayList,
  setDMRelayList,
  setFollowList,
  setMuteList,
} from "../../store/slices/identitySlice";
import type { SignerType } from "../../store/slices/identitySlice";
import {
  addRelay,
  setRelayStatus,
  updateLatency,
} from "../../store/slices/relaysSlice";
import type { Kind0Profile } from "../../types/profile";
import type { RelayListEntry } from "../../types/relay";
import { detectSigner, createSigner, type NostrSigner } from "./signer";
import { relayManager } from "./relayManager";
import { subscriptionManager } from "./subscriptionManager";
import { parseRelayList } from "./nip65";
import { parseDMRelayList, clearDMRelayCache } from "./dmRelayList";
import { EVENT_KINDS } from "../../types/nostr";
import { saveUserState, getUserState } from "../db/userStateStore";
import { loadSpaces } from "../db/spaceStore";
import { loadMusicLibrary } from "../db/musicStore";
import { getEventsByKind } from "../db/eventStore";
import { setSpaces, removeSpace, setChannels } from "../../store/slices/spacesSlice";
import { addNotification } from "../../store/slices/notificationSlice";
import { validateSpaces } from "../api/spaces";
import { removeSpaceFromStore } from "../db/spaceStore";
import {
  addTracks,
  addAlbums,
  addPlaylists,
  indexTrackByArtist,
  indexTrackByAlbum,
  setSavedTrackIds,
  setSavedAlbumIds,
  setFollowedArtists,
  setUserPlaylists,
  setRecentlyPlayedIds,
} from "../../store/slices/musicSlice";
import { parseTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { BOOTSTRAP_RELAYS, APP_RELAY } from "./constants";
import { signAndPublish } from "./publish";
import { buildDMRelayListEvent } from "./eventBuilder";
import { profileCache } from "./profileCache";
import { loadDMState, startDMPersistence } from "../../features/dm/dmPersistence";
import { loadFollowerState, startFollowerPersistence } from "./followerPersistence";
import { loadFriendRequestState, startFriendRequestPersistence } from "./friendRequestPersistence";
import { loadNotificationState, startNotificationPersistence } from "../../features/notifications/notificationPersistence";
import { startBackgroundChatSubs, closeBgChatSub } from "./groupSubscriptions";
import { loadChannels } from "../db/channelStore";
import { setKnownFollowers, addKnownFollower } from "../../store/slices/identitySlice";

let currentSigner: NostrSigner | null = null;

export function getSigner(): NostrSigner | null {
  return currentSigner;
}

/** Mute tag name → MuteEntry type */
const MUTE_TAG_MAP: Record<string, "pubkey" | "tag" | "word" | "event"> = {
  p: "pubkey",
  t: "tag",
  word: "word",
  e: "event",
};

/** Wire relay status changes from relayManager → Redux store */
function wireRelayStatusBridge(): void {
  relayManager.setGlobalCallbacks({
    onStatusChange: (url, status, error) => {
      const state = store.getState().relays.connections[url];
      if (!state) {
        // First time seeing this relay -- add it
        const conn = relayManager.getAllConnections().get(url);
        store.dispatch(
          addRelay({
            url,
            status,
            mode: conn?.mode ?? "read+write",
            latencyMs: conn?.getLatency() ?? 0,
            eventCount: conn?.getEventCount() ?? 0,
            error,
          }),
        );
      } else {
        store.dispatch(setRelayStatus({ url, status }));
      }

      if (status === "connected") {
        const conn = relayManager.getAllConnections().get(url);
        if (conn) {
          store.dispatch(updateLatency({ url, latencyMs: conn.getLatency() }));
        }
      }
    },
  });
}

/** Subscribe for user metadata (profile, follows, mutes) on given relays */
function subscribeUserData(
  pubkey: string,
  relayUrls?: string[],
): string {
  return relayManager.subscribe({
    filters: [
      { kinds: [EVENT_KINDS.METADATA], authors: [pubkey], limit: 1 },
      { kinds: [EVENT_KINDS.FOLLOW_LIST], authors: [pubkey], limit: 1 },
      { kinds: [EVENT_KINDS.MUTE_LIST], authors: [pubkey], limit: 1 },
    ],
    relayUrls,
    onEvent: (event) => {
      // Guard: only process events from the logged-in user
      if (event.pubkey !== pubkey) return;

      switch (event.kind) {
        case EVENT_KINDS.METADATA: {
          try {
            const profile = JSON.parse(event.content) as Kind0Profile;
            profile.created_at = event.created_at;
            store.dispatch(setProfile({ profile, createdAt: event.created_at }));
            // Keep profile cache in sync
            profileCache.handleProfileEvent(event);
          } catch {
            // Invalid profile JSON
          }
          break;
        }
        case EVENT_KINDS.FOLLOW_LIST: {
          const follows = event.tags
            .filter((t) => t[0] === "p" && t[1])
            .map((t) => t[1]);
          store.dispatch(setFollowList({ follows, createdAt: event.created_at }));
          saveUserState("follow_list", follows);
          break;
        }
        case EVENT_KINDS.MUTE_LIST: {
          const mutes = event.tags
            .filter((t) => t[0] in MUTE_TAG_MAP && t[1])
            .map((t) => ({
              type: MUTE_TAG_MAP[t[0]],
              value: t[1],
            }));
          store.dispatch(setMuteList({ mutes, createdAt: event.created_at }));
          saveUserState("mute_list", mutes);
          break;
        }
      }
    },
  });
}

/** Validate cached space IDs against backend and remove any that no longer exist */
async function validateAndPurgeStaleSpaces(spaceIds: string[]): Promise<void> {
  if (spaceIds.length === 0) return;
  const res = await validateSpaces(spaceIds);
  const deleted = res.data.deleted;
  if (deleted.length === 0) return;

  for (const id of deleted) {
    closeBgChatSub(id);
    store.dispatch(removeSpace(id));
    removeSpaceFromStore(id);
  }

  const names = deleted.length === 1 ? "A space you joined" : `${deleted.length} spaces you joined`;
  store.dispatch(
    addNotification({
      id: `space-removed-${Date.now()}`,
      type: "chat",
      title: "Space removed",
      body: `${names} no longer exist and have been removed.`,
      timestamp: Math.floor(Date.now() / 1000),
    }),
  );
}

/**
 * Full login flow.
 * @param signerTypeOverride - force a specific signer type
 * @param knownPubkey - skip getPublicKey() call if we already know the pubkey
 *                      (avoids extra keychain reads on macOS)
 */
export async function performLogin(
  signerTypeOverride?: "nip07" | "tauri",
  knownPubkey?: string,
): Promise<void> {
  // Step 1: Wire relay → Redux status bridge
  wireRelayStatusBridge();

  // Step 2: Connect to bootstrap relays and WAIT for at least one
  await relayManager.connectToBootstrapAndWait();

  // Step 3: Detect/create signer and get pubkey
  const signerType = signerTypeOverride ?? (await detectSigner());
  if (!signerType) {
    throw new Error(
      "No signer available. Install a NIP-07 extension or use the Desktop app.",
    );
  }

  currentSigner = await createSigner(signerType);
  // Use known pubkey if provided to avoid a redundant keychain read
  const pubkey = knownPubkey ?? (await currentSigner.getPublicKey());

  // Step 4: Dispatch login to Redux
  const storeSignerType: SignerType =
    signerType === "nip07" ? "nip07" : "tauri_keystore";
  store.dispatch(login({ pubkey, signerType: storeSignerType }));

  // Step 5: Load cached user data from IndexedDB for instant UI
  const cachedRelayList = await getUserState<RelayListEntry[]>("relay_list");
  if (cachedRelayList) {
    // createdAt: 0 so relay data always wins
    store.dispatch(setRelayList({ entries: cachedRelayList, createdAt: 0 }));
    relayManager.connectFromConfig(cachedRelayList);
  }

  // Step 5b: Load cached DM relay list from IndexedDB
  const cachedDMRelays = await getUserState<string[]>("dm_relay_list");
  if (cachedDMRelays?.length) {
    store.dispatch(setDMRelayList({ relays: cachedDMRelays, createdAt: 0 }));
  }

  // Step 6: Subscribe for relay list (kind:10002) from bootstrap relays
  relayManager.subscribe({
    filters: [{ kinds: [EVENT_KINDS.RELAY_LIST], authors: [pubkey], limit: 1 }],
    relayUrls: BOOTSTRAP_RELAYS,
    onEvent: (event) => {
      const entries = parseRelayList(event);
      if (entries.length > 0) {
        store.dispatch(setRelayList({ entries, createdAt: event.created_at }));
        saveUserState("relay_list", entries);
        // Connect to user's relays
        relayManager.connectFromConfig(entries);
        // Re-subscribe for user data on user's own relays
        const userRelayUrls = entries
          .filter((e) => e.mode === "read" || e.mode === "read+write")
          .map((e) => e.url);
        if (userRelayUrls.length > 0) {
          subscribeUserData(pubkey, userRelayUrls);
        }
      }
    },
  });

  // Step 6b: Subscribe for DM relay list (kind:10050) from bootstrap relays
  let dmRelayEoseReceived = false;
  relayManager.subscribe({
    filters: [{ kinds: [10050], authors: [pubkey], limit: 1 }],
    relayUrls: BOOTSTRAP_RELAYS,
    onEvent: (event) => {
      const relays = parseDMRelayList(event);
      if (relays.length > 0) {
        store.dispatch(setDMRelayList({ relays, createdAt: event.created_at }));
        saveUserState("dm_relay_list", relays);
        // Connect to DM relays so gift wraps can be received
        for (const url of relays) {
          relayManager.connect(url);
        }
      }
    },
    onEOSE: () => {
      if (dmRelayEoseReceived) return;
      dmRelayEoseReceived = true;
      // If no kind:10050 found and no cache, auto-publish defaults
      const currentDMRelays = store.getState().identity.dmRelayList;
      if (currentDMRelays.length === 0) {
        const defaults = [APP_RELAY, "wss://relay.damus.io", "wss://nos.lol"];
        const unsigned = buildDMRelayListEvent(pubkey, defaults);
        signAndPublish(unsigned, BOOTSTRAP_RELAYS).then(() => {
          store.dispatch(setDMRelayList({ relays: defaults, createdAt: Math.floor(Date.now() / 1000) }));
          saveUserState("dm_relay_list", defaults);
        }).catch((err) => {
          console.error("[LoginFlow] Failed to auto-publish kind:10050:", err);
        });
      }
    },
  });

  // Step 7: Subscribe for user metadata from bootstrap relays
  subscribeUserData(pubkey, BOOTSTRAP_RELAYS);

  // Step 7b: Load spaces from IndexedDB
  const savedSpaces = await loadSpaces();
  if (savedSpaces.length > 0) {
    store.dispatch(setSpaces(savedSpaces));

    // Non-blocking: validate cached spaces against backend and purge stale ones
    validateAndPurgeStaleSpaces(savedSpaces.map((s) => s.id)).catch(() => {});

    // Preload cached channels for all spaces from IndexedDB so the
    // notification evaluator can resolve the correct channel IDs
    // (e.g. "spaceId:ch_abc" instead of fallback "spaceId:chat")
    await Promise.all(
      savedSpaces.map(async (space) => {
        try {
          const cached = await loadChannels(space.id);
          if (cached && cached.length > 0) {
            store.dispatch(setChannels({ spaceId: space.id, channels: cached }));
          }
        } catch {
          // IndexedDB read failed — channels will be fetched from backend later
        }
      }),
    );

    // NOTE: Background chat subs are started AFTER notification state is
    // restored (step 7f-c below) to ensure lastReadTimestamps are available.
    // This prevents re-fetched messages from being double-counted as unread.
  }

  // Step 7c: Load music events from IndexedDB, filtering out any that have
  // been deleted (kind:5 events referencing them via "a" tags)
  const [trackEvents, albumEvents, playlistEvents, deletionEvents] = await Promise.all([
    getEventsByKind(EVENT_KINDS.MUSIC_TRACK, 500),
    getEventsByKind(EVENT_KINDS.MUSIC_ALBUM, 200),
    getEventsByKind(EVENT_KINDS.MUSIC_PLAYLIST, 200),
    getEventsByKind(EVENT_KINDS.DELETION, 500),
  ]);

  // Build deletion lookups from persisted deletion events.
  // For addressable IDs ("a" tags), track the deletion timestamp so that
  // re-published events (created AFTER the deletion) are NOT filtered out.
  const deletedAddrTimestamps = new Map<string, number>(); // addr → latest deletion created_at
  const deletedEventIds = new Set<string>();
  for (const delEvt of deletionEvents) {
    for (const tag of delEvt.tags) {
      if (tag[0] === "a" && tag[1]) {
        // Only honor deletions from the content author
        const addrPubkey = tag[1].split(":")[1];
        if (addrPubkey === delEvt.pubkey) {
          const prev = deletedAddrTimestamps.get(tag[1]) ?? 0;
          deletedAddrTimestamps.set(tag[1], Math.max(prev, delEvt.created_at));
        }
      }
      if (tag[0] === "e" && tag[1]) {
        deletedEventIds.add(tag[1]);
      }
    }
  }

  /** Check if an event is superseded by a deletion (only for events created before the deletion) */
  function isDeletedByAddr(event: { pubkey: string; created_at: number; tags: string[][] }, kindNum: number): boolean {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1];
    if (dTag === undefined) return false;
    const addr = `${kindNum}:${event.pubkey}:${dTag}`;
    const deletedAt = deletedAddrTimestamps.get(addr);
    // Only filter if the event was created BEFORE or AT the deletion time.
    // Events re-published AFTER a deletion supersede it.
    return deletedAt !== undefined && event.created_at <= deletedAt;
  }

  const liveTrackEvents = trackEvents.filter(
    (e) => !deletedEventIds.has(e.id) && !isDeletedByAddr(e, EVENT_KINDS.MUSIC_TRACK),
  );
  const liveAlbumEvents = albumEvents.filter(
    (e) => !deletedEventIds.has(e.id) && !isDeletedByAddr(e, EVENT_KINDS.MUSIC_ALBUM),
  );
  const livePlaylistEvents = playlistEvents.filter(
    (e) => !deletedEventIds.has(e.id) && !isDeletedByAddr(e, EVENT_KINDS.MUSIC_PLAYLIST),
  );

  if (liveTrackEvents.length > 0) {
    const tracks = liveTrackEvents.map(parseTrackEvent);
    store.dispatch(addTracks(tracks));
    for (const track of tracks) {
      store.dispatch(indexTrackByArtist({ pubkey: track.pubkey, addressableId: track.addressableId }));
      if (track.featuredArtists) {
        for (const fp of track.featuredArtists) {
          store.dispatch(indexTrackByArtist({ pubkey: fp, addressableId: track.addressableId }));
        }
      }
      if (track.albumRef) {
        store.dispatch(indexTrackByAlbum({ albumAddrId: track.albumRef, trackAddrId: track.addressableId }));
      }
    }
  }
  if (liveAlbumEvents.length > 0) {
    store.dispatch(addAlbums(liveAlbumEvents.map(parseAlbumEvent)));
  }
  if (livePlaylistEvents.length > 0) {
    store.dispatch(addPlaylists(livePlaylistEvents.map(parsePlaylistEvent)));
  }

  // Step 7d: Load music library state from IndexedDB
  const musicLib = await loadMusicLibrary();
  if (musicLib) {
    store.dispatch(setSavedTrackIds(musicLib.savedTrackIds));
    store.dispatch(setSavedAlbumIds(musicLib.savedAlbumIds));
    store.dispatch(setFollowedArtists(musicLib.followedArtists));
    store.dispatch(setUserPlaylists(musicLib.userPlaylists));
    store.dispatch(setRecentlyPlayedIds(musicLib.recentlyPlayedIds));
  }

  // Step 7e: Subscribe for user's own music events + deletion events from relays
  // Events flow through processIncomingEvent → Redux + IndexedDB persistence
  subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM, EVENT_KINDS.MUSIC_PLAYLIST, EVENT_KINDS.DELETION],
        authors: [pubkey],
        limit: 500,
      },
    ],
    relayUrls: BOOTSTRAP_RELAYS,
  });

  // Step 7f: Load persisted DMs from IndexedDB BEFORE subscribing to relays.
  // This populates processedWrapIds so relay echoes are deduped and
  // messages keep their original display timestamps.
  await loadDMState();
  startDMPersistence();

  // Step 7f-b: Load persisted friend requests from IndexedDB
  await loadFriendRequestState();
  startFriendRequestPersistence();

  // Step 7f-c: Load persisted notification state (unread counts, preferences, mutes).
  // MUST complete before background chat subs so lastReadTimestamps are available
  // for the notification evaluator to skip already-read messages.
  await loadNotificationState();
  startNotificationPersistence();

  // Step 7f-d: NOW start background chat subs — notification state is restored,
  // so re-fetched messages will be correctly filtered by lastReadTimestamps.
  if (savedSpaces.length > 0) {
    startBackgroundChatSubs(savedSpaces);
  }

  // Step 7g: Subscribe for gift-wrapped DMs (kind:1059) addressed to us.
  // Use a persisted timestamp so we catch all wraps since the last session.
  // NIP-17 randomizes created_at up to 2 days back, so subtract a 3-day buffer
  // from our last-seen timestamp to avoid missing events.
  const THREE_DAYS = 3 * 24 * 60 * 60;
  const lastGiftWrapTs = await getUserState<number>("last_gift_wrap_ts");
  const giftWrapFilter: import("../../types/nostr").NostrFilter = {
    kinds: [EVENT_KINDS.GIFT_WRAP],
    "#p": [pubkey],
  };
  if (lastGiftWrapTs) {
    // Fetch all wraps since (lastSeen - 3 days) to account for NIP-17 timestamp randomization
    giftWrapFilter.since = lastGiftWrapTs - THREE_DAYS;
  } else {
    // First login: fetch a reasonable initial batch
    giftWrapFilter.limit = 200;
  }
  // Subscribe on DM relays (if known) plus bootstrap for transition coverage
  const dmRelays = store.getState().identity.dmRelayList;
  const giftWrapRelayUrls = dmRelays.length > 0
    ? [...new Set([...dmRelays, ...BOOTSTRAP_RELAYS])]
    : BOOTSTRAP_RELAYS;
  subscriptionManager.subscribe({
    filters: [giftWrapFilter],
    relayUrls: giftWrapRelayUrls,
  });
  // Persist current timestamp for next session
  saveUserState("last_gift_wrap_ts", Math.floor(Date.now() / 1000)).catch(() => {});

  // Step 7h: Load cached followers, then subscribe for kind:3 events that tag us.
  // Use all connected read relays (not just bootstrap) so user-configured relays are included.
  // Buffer follower pubkeys until EOSE, then MERGE with cached set (never shrink).
  await loadFollowerState();
  startFollowerPersistence();

  const followerBuffer: string[] = [];
  let followerEoseCount = 0;
  // Use all connected read relays, falling back to bootstrap count
  const connectedReadRelays = relayManager.getReadRelays();
  const followerRelayCount = Math.max(connectedReadRelays.length, BOOTSTRAP_RELAYS.length);

  relayManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.FOLLOW_LIST],
        "#p": [pubkey],
        limit: 500,
      },
    ],
    // Don't restrict to BOOTSTRAP_RELAYS — let relayManager use all read relays
    onEvent: (event) => {
      // Only care about events that include us in their follow list
      if (event.pubkey === pubkey) return;
      const followsUs = event.tags.some(
        (t) => t[0] === "p" && t[1] === pubkey,
      );
      if (!followsUs) return;

      if (followerEoseCount < followerRelayCount) {
        // Still buffering — collect pubkeys
        if (!followerBuffer.includes(event.pubkey)) {
          followerBuffer.push(event.pubkey);
        }
      } else {
        // Post-EOSE: genuinely new follower
        store.dispatch(addKnownFollower(event.pubkey));
      }
    },
    onEOSE: () => {
      followerEoseCount++;
      if (followerEoseCount >= followerRelayCount) {
        // Merge buffered followers with cached set — always union, never replace with smaller
        const cached = store.getState().identity.knownFollowers;
        const merged = Array.from(new Set([...cached, ...followerBuffer]));
        store.dispatch(setKnownFollowers(merged));
      }
    },
  });

  // Step 8: Persist session for restore
  await saveUserState("session", {
    pubkey,
    signerType: storeSignerType,
  });
}

/** Try to restore a previous session from IndexedDB */
export async function tryRestoreSession(): Promise<boolean> {
  const session = await getUserState<{
    pubkey: string;
    signerType: SignerType;
  }>("session");
  if (!session?.pubkey || !session.signerType) return false;

  // Map stored signer type back to signer factory type
  const factoryType: "nip07" | "tauri" =
    session.signerType === "nip07" ? "nip07" : "tauri";

  // Verify the signer is still available
  if (factoryType === "nip07") {
    if (typeof window === "undefined" || !("nostr" in window) || !window.nostr) {
      return false;
    }
  } else {
    if (
      typeof window === "undefined" ||
      !("__TAURI_INTERNALS__" in window)
    ) {
      return false;
    }
  }

  try {
    // Pass saved pubkey so we skip the keychain read on restore
    await performLogin(factoryType, session.pubkey);
    return true;
  } catch {
    return false;
  }
}

/** Logout */
export function performLogout(): void {
  currentSigner = null;
  profileCache.clear();
  clearDMRelayCache();
  relayManager.disconnectAll();
  saveUserState("session", null);
}
