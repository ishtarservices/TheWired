import { store } from "../../store";
import {
  login,
  setProfile,
  setRelayList,
  setDMRelayList,
  setFollowList,
  setMuteList,
  setPinnedNotes,
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
import { handlePotentialKick } from "./kickHandler";
import { parseRelayList } from "./nip65";
import { parseDMRelayList, clearDMRelayCache } from "./dmRelayList";
import { EVENT_KINDS } from "../../types/nostr";
import { saveUserState, getUserState } from "../db/userStateStore";
import { loadSpaces, saveSpaces } from "../db/spaceStore";
import { loadAllMembers } from "../db/spaceMembersStore";
import { setMembers } from "../../store/slices/spaceConfigSlice";
import { updateSpaceMembers } from "../../store/slices/spacesSlice";
import { syncSpaceMembers } from "../../store/thunks/spaceMembers";
import { loadMusicLibrary } from "../db/musicStore";
import { getEventsByKind } from "../db/eventStore";
import { setSpaces, removeSpace, setChannels, setActiveSpace } from "../../store/slices/spacesSlice";
import { trackDeletedNote, restoreDeletedAddrIds } from "../../store/slices/eventsSlice";
import { addNotification } from "../../store/slices/notificationSlice";
import { validateSpaces, fetchMySpaces } from "../api/spaces";
import { saveChannels } from "../db/channelStore";
import { removeSpaceFromStore } from "../db/spaceStore";
import {
  addTracks,
  addAlbums,
  addPlaylists,
  addAnnotation,
  indexTrackByArtist,
  indexTrackByAlbum,
  indexTrackByArtistName,
  indexAlbumByArtist,
  indexAlbumByArtistName,
  setSavedTrackIds,
  setSavedAlbumIds,
  setFavoritedTrackIds,
  setFavoritedAlbumIds,
  setFollowedArtists,
  setUserPlaylists,
  setRecentlyPlayedIds,
} from "../../store/slices/musicSlice";
import { parseTrackEvent, parsePrivateTrackEvent } from "../../features/music/trackParser";
import { parseAlbumEvent, parsePrivateAlbumEvent } from "../../features/music/albumParser";
import { parsePlaylistEvent } from "../../features/music/playlistParser";
import { parseAnnotationEvent } from "../../features/music/annotationParser";
import { BOOTSTRAP_RELAYS, APP_RELAY, PROFILE_RELAYS } from "./constants";
import { signAndPublish } from "./publish";
import { buildDMRelayListEvent } from "./eventBuilder";
import { profileCache } from "./profileCache";
import { loadDMState, startDMPersistence, cancelPendingSave as cancelDMSave, flushPendingSave as flushDMSave } from "../../features/dm/dmPersistence";
import { loadDMReadState, startDMReadStateSync, cancelPendingSave as cancelDMReadStateSave, flushPendingSave as flushDMReadStateSave } from "../../features/dm/dmReadState";
import { loadFollowerState, startFollowerPersistence, cancelPendingSave as cancelFollowerSave, flushPendingSave as flushFollowerSave } from "./followerPersistence";
import { loadFriendRequestState, startFriendRequestPersistence, cancelPendingSave as cancelFriendRequestSave, flushPendingSave as flushFriendRequestSave } from "./friendRequestPersistence";
import { loadNotificationState, startNotificationPersistence, cancelPendingSave as cancelNotificationSave, flushPendingSave as flushNotificationSave } from "../../features/notifications/notificationPersistence";
import { resetEventPipelineCaches } from "./eventPipeline";
import { verifyBridge } from "./verifyWorkerBridge";
import { startBackgroundChatSubs, closeBgChatSub, stopAllBgChatSubs } from "./groupSubscriptions";
import { loadChannels } from "../db/channelStore";
import { initLastChannelCache, clearLastChannelCache } from "../db/lastChannelCache";
import { clearAllSubscriptions } from "../db/subscriptionStore";
import { clearAllUserState } from "../db/userStateStore";
import { resetAll } from "../../store";
import {
  setKnownFollowers,
  addKnownFollower,
  setAccounts,
  setSwitchingAccount,
  type AccountEntry,
} from "../../store/slices/identitySlice";
import { setActivePubkey, clearAccountState, migrateUnprefixedState } from "../db/userStateStore";
import { TauriSigner } from "./tauriSigner";
import {
  restoreOnboardingState,
  setShowProfileWizard,
} from "../../features/onboarding/onboardingSlice";
import { loadOnboardingState } from "../../features/onboarding/onboardingPersistence";

let currentSigner: NostrSigner | null = null;

/** Persistence listener cleanup functions — captured so we can stop them on logout */
let cleanupDMPersistence: (() => void) | null = null;
let cleanupDMReadState: (() => void) | null = null;
let cleanupFollowerPersistence: (() => void) | null = null;
let cleanupFriendRequestPersistence: (() => void) | null = null;
let cleanupNotificationPersistence: (() => void) | null = null;
let cleanupActiveSpacePersistence: (() => void) | null = null;

export function getSigner(): NostrSigner | null {
  return currentSigner;
}

/** Multi-account session format */
interface MultiAccountSession {
  accounts: AccountEntry[];
  activePubkey: string;
}

/** Legacy session format (pre-multi-account) */
interface LegacySession {
  pubkey: string;
  signerType: SignerType;
}

function isMultiAccountSession(s: unknown): s is MultiAccountSession {
  return !!s && typeof s === "object" && "accounts" in s && Array.isArray((s as MultiAccountSession).accounts);
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
    onOK: (eventId, success, message, relayUrl) => {
      if (!success) {
        console.warn(`[relay] ${relayUrl} rejected ${eventId.slice(0, 8)}: ${message}`);
        // Reactive kick detection: if the relay rejected this event because
        // we're no longer a member, sync membership and clean up locally.
        // No-op for any other rejection.
        void handlePotentialKick(eventId, success, message);
      }
    },
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
      { kinds: [EVENT_KINDS.PINNED_NOTES], authors: [pubkey], limit: 1 },
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
        case EVENT_KINDS.PINNED_NOTES: {
          const noteIds = event.tags
            .filter((t) => t[0] === "e" && t[1])
            .map((t) => t[1]);
          store.dispatch(setPinnedNotes({ noteIds, createdAt: event.created_at }));
          saveUserState("pinned_notes", noteIds);
          break;
        }
      }
    },
    onEOSE: () => {
      // If no kind:3 was found on relays (new user or contact list not on these
      // relays), mark the follow list as loaded so follow actions aren't blocked.
      // createdAt: 1 is a sentinel meaning "checked relays, confirmed empty" —
      // any real kind:3 event will have a much larger timestamp and override this.
      const { followListCreatedAt } = store.getState().identity;
      if (followListCreatedAt === 0) {
        store.dispatch(setFollowList({ follows: [], createdAt: 1 }));
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

  // For Tauri with a known pubkey (session restore / account switch), set the
  // Rust-side ACTIVE_PUBKEY BEFORE creating the signer. Without this, the Rust
  // keystore's get_active_secret_key sees ACTIVE_PUBKEY=None on fresh app start
  // and may fall through to generating a brand-new keypair instead of loading
  // the stored one.
  if (signerType === "tauri" && knownPubkey) {
    try {
      await TauriSigner.switchAccount(knownPubkey);
    } catch {
      // Key may not exist yet (first login / import) — getPublicKey will handle it
    }
  }

  currentSigner = await createSigner(signerType);
  const signerPubkey = await currentSigner.getPublicKey();
  if (knownPubkey && knownPubkey !== signerPubkey) {
    // The signer returned a different key than the session expected. This means
    // the stored key was lost (keychain wiped, unsigned dev build, etc.). Do NOT
    // silently continue with the wrong key — that creates phantom accounts and
    // triggers the onboarding wizard.
    console.error(
      `[LoginFlow] Signer key mismatch — session=${knownPubkey.slice(0, 12)}… signer=${signerPubkey.slice(0, 12)}… — aborting login`,
    );
    throw new Error("Stored key not found in keystore. The key may have been removed from the OS keychain.");
  }
  const pubkey = signerPubkey;

  // Set active pubkey for per-account IndexedDB key prefixing
  setActivePubkey(pubkey);

  // Step 4: Dispatch login to Redux
  const storeSignerType: SignerType =
    signerType === "nip07" ? "nip07" : "tauri_keystore";
  store.dispatch(login({ pubkey, signerType: storeSignerType }));

  // Replay NIP-42 AUTH on any relay that connected (and challenged) before the
  // signer was ready. Without this, a relay connection established pre-login
  // stays unauthenticated forever — which silently filters out every h-tagged
  // event (NIP-29 chat) on both query and broadcast paths.
  relayManager.replayAuth();

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
    // Pre-connect cached DM relays so gift wrap subscription can reach them
    for (const url of cachedDMRelays) {
      relayManager.connect(url);
    }
  }

  // Step 5c: Load cached follow list from IndexedDB
  // CRITICAL: without this, followList starts as [] after login/reset, and any
  // follow action (manual or auto-follow from friend accept) would publish a
  // kind:3 containing only the new follow — nuking the real contact list.
  const cachedFollowList = await getUserState<string[]>("follow_list");
  if (cachedFollowList?.length) {
    store.dispatch(setFollowList({ follows: cachedFollowList, createdAt: 0 }));
  }

  // Step 5d: Load cached pinned notes from IndexedDB
  const cachedPinnedNotes = await getUserState<string[]>("pinned_notes");
  if (cachedPinnedNotes?.length) {
    store.dispatch(setPinnedNotes({ noteIds: cachedPinnedNotes, createdAt: 0 }));
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

  // Step 7b: Load spaces + last-channel cache from IndexedDB
  await initLastChannelCache();
  let savedSpaces = await loadSpaces();

  // If local cache is empty, recover from backend (covers logout/reimport,
  // cache wipe, phantom account bug, or first multi-device login)
  if (savedSpaces.length === 0) {
    try {
      const res = await fetchMySpaces();
      if (res.data.length > 0) {
        savedSpaces = res.data.map((entry) => ({
          id: entry.space.id,
          hostRelay: entry.space.hostRelay,
          name: entry.space.name,
          picture: entry.space.picture ?? undefined,
          about: entry.space.about ?? undefined,
          isPrivate: false,
          adminPubkeys: [],
          memberPubkeys: [],
          feedPubkeys: entry.feedPubkeys,
          mode: entry.space.mode as "read" | "read-write",
          creatorPubkey: entry.space.creatorPubkey ?? "",
          createdAt: 0,
        }));

        // Persist recovered spaces + channels to IndexedDB for next startup
        await saveSpaces(savedSpaces);
        for (const entry of res.data) {
          if (entry.channels.length > 0) {
            // Normalize channels to ensure feedMode is present (backward compat)
            const normalized = entry.channels.map((ch: any) => ({
              ...ch,
              feedMode: ch.feedMode ?? "all",
            }));
            await saveChannels(entry.space.id, normalized);
          }
        }

        // Hydrate channels into Redux
        for (const entry of res.data) {
          if (entry.channels.length > 0) {
            const normalized = entry.channels.map((ch: any) => ({
              ...ch,
              feedMode: ch.feedMode ?? "all",
            }));
            store.dispatch(setChannels({ spaceId: entry.space.id, channels: normalized }));
          }
        }
      }
    } catch {
      // Backend unreachable — spaces will appear empty until next login
    }
  }

  if (savedSpaces.length > 0) {
    store.dispatch(setSpaces(savedSpaces));

    // Hydrate members + roles from IndexedDB so MemberList paints correctly
    // on first render (no admin-as-member flicker). Then fire a background
    // revalidation per space — corrects any drift (kicks/bans/role changes
    // that happened while the app was closed) within seconds.
    try {
      const cachedMembers = await loadAllMembers();
      for (const [spaceId, members] of cachedMembers) {
        store.dispatch(setMembers({ spaceId, members }));
        store.dispatch(
          updateSpaceMembers({ spaceId, members: members.map((m) => m.pubkey) }),
        );
      }
    } catch {
      // IDB read failed — refresh below will populate state from backend
    }
    for (const space of savedSpaces) {
      void store.dispatch(syncSpaceMembers(space.id));
    }

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

    // Restore active space from IndexedDB (or default to first space)
    const lastActiveSpace = await getUserState<string>("active_space");
    if (lastActiveSpace && savedSpaces.some((s) => s.id === lastActiveSpace)) {
      store.dispatch(setActiveSpace(lastActiveSpace));
    } else {
      store.dispatch(setActiveSpace(savedSpaces[0].id));
    }

    // NOTE: Background chat subs are started AFTER notification state is
    // restored (step 7f-c below) to ensure lastReadTimestamps are available.
    // This prevents re-fetched messages from being double-counted as unread.
  }

  // Step 7c: Load music events from IndexedDB, filtering out any that have
  // been deleted (kind:5 events referencing them via "a" tags)
  const [trackEvents, albumEvents, playlistEvents, annotationEvents, deletionEvents] = await Promise.all([
    getEventsByKind(EVENT_KINDS.MUSIC_TRACK, 500),
    getEventsByKind(EVENT_KINDS.MUSIC_ALBUM, 200),
    getEventsByKind(EVENT_KINDS.MUSIC_PLAYLIST, 200),
    getEventsByKind(EVENT_KINDS.MUSIC_TRACK_NOTES, 500),
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

  // Populate Redux deletion tracking so re-delivered events from relays are rejected
  for (const eventId of deletedEventIds) {
    store.dispatch(trackDeletedNote(eventId));
  }
  if (deletedAddrTimestamps.size > 0) {
    store.dispatch(restoreDeletedAddrIds(Object.fromEntries(deletedAddrTimestamps)));
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

  // Helper to index a parsed track into Redux
  const indexParsedTrack = (track: import("../../types/music").MusicTrack) => {
    if (track.artistPubkeys.length > 0) {
      for (const pk of track.artistPubkeys) {
        store.dispatch(indexTrackByArtist({ pubkey: pk, addressableId: track.addressableId }));
      }
    } else if (track.artist && track.artist !== track.pubkey) {
      store.dispatch(indexTrackByArtistName({ normalizedName: track.artist.toLowerCase().trim(), addressableId: track.addressableId }));
    } else {
      store.dispatch(indexTrackByArtist({ pubkey: track.pubkey, addressableId: track.addressableId }));
    }
    for (const fp of track.featuredArtists) {
      store.dispatch(indexTrackByArtist({ pubkey: fp, addressableId: track.addressableId }));
    }
    for (const cp of track.collaborators) {
      store.dispatch(indexTrackByArtist({ pubkey: cp, addressableId: track.addressableId }));
    }
    if (track.albumRef) {
      store.dispatch(indexTrackByAlbum({ albumAddrId: track.albumRef, trackAddrId: track.addressableId }));
    }
  };

  // Helper to index a parsed album into Redux
  const indexParsedAlbum = (album: import("../../types/music").MusicAlbum) => {
    if (album.artistPubkeys.length > 0) {
      for (const pk of album.artistPubkeys) {
        store.dispatch(indexAlbumByArtist({ pubkey: pk, addressableId: album.addressableId }));
      }
    } else if (album.artist && album.artist !== album.pubkey) {
      store.dispatch(indexAlbumByArtistName({ normalizedName: album.artist.toLowerCase().trim(), addressableId: album.addressableId }));
    } else {
      store.dispatch(indexAlbumByArtist({ pubkey: album.pubkey, addressableId: album.addressableId }));
    }
    for (const fp of album.featuredArtists) {
      store.dispatch(indexAlbumByArtist({ pubkey: fp, addressableId: album.addressableId }));
    }
    for (const cp of album.collaborators) {
      store.dispatch(indexAlbumByArtist({ pubkey: cp, addressableId: album.addressableId }));
    }
  };

  if (liveTrackEvents.length > 0) {
    // Separate public and private tracks — private need async NIP-44 decryption
    const publicTracks: typeof liveTrackEvents = [];
    const privateTracks: typeof liveTrackEvents = [];
    for (const e of liveTrackEvents) {
      const isPrivate = e.tags.some(
        (t) => t[0] === "visibility" && (t[1] === "private" || t[1] === "unlisted"),
      );
      if (isPrivate && e.content) {
        privateTracks.push(e);
      } else {
        publicTracks.push(e);
      }
    }

    // Dispatch public tracks immediately (sync)
    if (publicTracks.length > 0) {
      const tracks = publicTracks.map(parseTrackEvent);
      store.dispatch(addTracks(tracks));
      for (const track of tracks) indexParsedTrack(track);
    }

    // Decrypt private tracks async (non-blocking — UI shows public tracks first)
    if (privateTracks.length > 0) {
      Promise.all(
        privateTracks.map((e) => parsePrivateTrackEvent(e, pubkey).catch(() => null)),
      ).then((results) => {
        const decrypted = results.filter(Boolean) as import("../../types/music").MusicTrack[];
        if (decrypted.length > 0) {
          store.dispatch(addTracks(decrypted));
          for (const track of decrypted) indexParsedTrack(track);
        }
      });
    }
  }
  if (liveAlbumEvents.length > 0) {
    // Same split for albums
    const publicAlbums: typeof liveAlbumEvents = [];
    const privateAlbums: typeof liveAlbumEvents = [];
    for (const e of liveAlbumEvents) {
      const isPrivate = e.tags.some(
        (t) => t[0] === "visibility" && (t[1] === "private" || t[1] === "unlisted"),
      );
      if (isPrivate && e.content) {
        privateAlbums.push(e);
      } else {
        publicAlbums.push(e);
      }
    }

    if (publicAlbums.length > 0) {
      const albums = publicAlbums.map(parseAlbumEvent);
      store.dispatch(addAlbums(albums));
      for (const album of albums) indexParsedAlbum(album);
    }

    if (privateAlbums.length > 0) {
      Promise.all(
        privateAlbums.map((e) => parsePrivateAlbumEvent(e, pubkey).catch(() => null)),
      ).then((results) => {
        const decrypted = results.filter(Boolean) as import("../../types/music").MusicAlbum[];
        if (decrypted.length > 0) {
          store.dispatch(addAlbums(decrypted));
          for (const album of decrypted) indexParsedAlbum(album);
        }
      });
    }
  }
  if (livePlaylistEvents.length > 0) {
    store.dispatch(addPlaylists(livePlaylistEvents.map(parsePlaylistEvent)));
  }

  // Restore annotations from IndexedDB, filtering deletions
  const liveAnnotationEvents = annotationEvents.filter(
    (e) => !deletedEventIds.has(e.id) && !isDeletedByAddr(e, EVENT_KINDS.MUSIC_TRACK_NOTES),
  );
  for (const evt of liveAnnotationEvents) {
    const annotation = parseAnnotationEvent(evt);
    if (annotation) {
      store.dispatch(addAnnotation(annotation));
    }
  }

  // Step 7d: Load music library state from IndexedDB
  const musicLib = await loadMusicLibrary();
  if (musicLib) {
    store.dispatch(setSavedTrackIds(musicLib.savedTrackIds));
    store.dispatch(setSavedAlbumIds(musicLib.savedAlbumIds));
    if (musicLib.favoritedTrackIds) {
      store.dispatch(setFavoritedTrackIds(musicLib.favoritedTrackIds));
    }
    if (musicLib.favoritedAlbumIds) {
      store.dispatch(setFavoritedAlbumIds(musicLib.favoritedAlbumIds));
    }
    store.dispatch(setFollowedArtists(musicLib.followedArtists));
    store.dispatch(setUserPlaylists(musicLib.userPlaylists));
    store.dispatch(setRecentlyPlayedIds(musicLib.recentlyPlayedIds));
  }

  // Step 7d-b: Load notification state BEFORE relay subscriptions so that
  // re-delivered events (which trigger evaluateCollaboratorNotification)
  // find existing notifications and skip them via addNotification dedup.
  await loadNotificationState();
  cleanupNotificationPersistence = startNotificationPersistence();

  // Step 7e: Subscribe for user's own music events + deletion events from relays
  // Events flow through processIncomingEvent → Redux + IndexedDB persistence
  subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM, EVENT_KINDS.MUSIC_PLAYLIST, EVENT_KINDS.MUSIC_TRACK_NOTES, EVENT_KINDS.DELETION],
        authors: [pubkey],
        limit: 500,
      },
    ],
    relayUrls: PROFILE_RELAYS,
  });

  // Step 7e-a: Subscribe for music events where we are tagged (collaborator, featured artist).
  // Without this, private tracks shared with us via p-tags would never arrive.
  subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM],
        "#p": [pubkey],
        limit: 200,
      },
    ],
    relayUrls: PROFILE_RELAYS,
  });

  // Step 7e-b: Re-fetch any saved items that are missing from Redux.
  // This handles albums/tracks from API responses that weren't persisted to IndexedDB,
  // or events that were evicted by TTL. Events arrive via eventPipeline → IndexedDB + Redux.
  if (musicLib) {
    const currentMusic = store.getState().music;
    const missingIds = [
      ...musicLib.savedAlbumIds.filter((id) => !currentMusic.albums[id]),
      ...musicLib.savedTrackIds.filter((id) => !currentMusic.tracks[id]),
    ];
    if (missingIds.length > 0) {
      // Group by kind:author to minimize filter count
      const groups = new Map<string, string[]>();
      for (const addrId of missingIds) {
        const parts = addrId.split(":");
        const key = `${parts[0]}:${parts[1]}`;
        const dTag = parts.slice(2).join(":");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(dTag);
      }
      const filters: import("../../types/nostr").NostrFilter[] = [];
      for (const [key, dTags] of groups) {
        const [kindStr, authorPk] = key.split(":");
        filters.push({ kinds: [parseInt(kindStr, 10)], authors: [authorPk], "#d": dTags });
      }
      subscriptionManager.subscribe({ filters, relayUrls: PROFILE_RELAYS });
    }
  }

  // Step 7e-b: Load persisted deleted message IDs from IndexedDB
  {
    const { getUserState } = await import("../db/userStateStore");
    const { restoreDeletedMessageIds } = await import("../../store/slices/eventsSlice");
    const deletedIds = await getUserState<Record<string, true>>("deletedMessageIds");
    if (deletedIds) {
      store.dispatch(restoreDeletedMessageIds(deletedIds));
    }
  }

  // Step 7f: Load persisted DMs from IndexedDB BEFORE subscribing to relays.
  // This populates processedWrapIds so relay echoes are deduped and
  // messages keep their original display timestamps.
  await loadDMState();
  cleanupDMPersistence = startDMPersistence();

  // Step 7f-a: Fetch relay-synced DM read state (NIP-78).
  // This populates lastReadTimestamps so re-fetched DMs after a cache clear
  // are correctly marked as already-read.
  loadDMReadState();
  cleanupDMReadState = startDMReadStateSync();

  // Step 7f-b: Load persisted friend requests from IndexedDB
  await loadFriendRequestState();
  cleanupFriendRequestPersistence = startFriendRequestPersistence();

  // Step 7f-c: Notification state already loaded in step 7d-b (before relay subs).

  // Step 7f-d: NOW start background chat subs — notification state is restored,
  // so re-fetched messages will be correctly filtered by lastReadTimestamps.
  if (savedSpaces.length > 0) {
    startBackgroundChatSubs(savedSpaces);
  }

  // Persist active space changes to IndexedDB for restore on next login/switch
  {
    let lastSpaceId = store.getState().spaces.activeSpaceId;
    cleanupActiveSpacePersistence = store.subscribe(() => {
      const current = store.getState().spaces.activeSpaceId;
      if (current !== lastSpaceId) {
        lastSpaceId = current;
        if (current) {
          saveUserState("active_space", current).catch(() => {});
        }
      }
    });
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
  cleanupFollowerPersistence = startFollowerPersistence();

  const followerBuffer: string[] = [];
  let followerMerged = false;

  const mergeFollowers = () => {
    if (followerMerged) return;
    followerMerged = true;
    clearTimeout(followerTimer);
    // Merge buffered followers with cached set — always union, never replace with smaller
    const cached = store.getState().identity.knownFollowers;
    const merged = Array.from(new Set([...cached, ...followerBuffer]));
    store.dispatch(setKnownFollowers(merged));
  };

  relayManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.FOLLOW_LIST],
        "#p": [pubkey],
        limit: 500,
      },
    ],
    relayUrls: PROFILE_RELAYS,
    onEvent: (event) => {
      // Only care about events that include us in their follow list
      if (event.pubkey === pubkey) return;
      const followsUs = event.tags.some(
        (t) => t[0] === "p" && t[1] === pubkey,
      );
      if (!followsUs) return;

      if (!followerMerged) {
        // Still buffering — collect pubkeys
        if (!followerBuffer.includes(event.pubkey)) {
          followerBuffer.push(event.pubkey);
        }
      } else {
        // Post-merge: genuinely new follower
        store.dispatch(addKnownFollower(event.pubkey));
      }
    },
    onEOSE: mergeFollowers,
  });

  // Safety: merge whatever we have if no EOSE arrives
  const followerTimer = setTimeout(mergeFollowers, 10_000);

  // Step 8: Persist multi-account session
  const existingSession = await getUserState<MultiAccountSession>("session");
  const accounts: AccountEntry[] = existingSession?.accounts ?? [];
  const existingIdx = accounts.findIndex((a) => a.pubkey === pubkey);
  const entry: AccountEntry = { pubkey, signerType: storeSignerType, addedAt: Date.now() };
  if (existingIdx >= 0) {
    accounts[existingIdx] = entry;
  } else {
    accounts.push(entry);
  }
  await saveUserState("session", { accounts, activePubkey: pubkey } satisfies MultiAccountSession);
  store.dispatch(setAccounts(accounts));

  // Step 9: Check onboarding state and trigger wizard for new users
  const onboardingState = await loadOnboardingState();
  store.dispatch(restoreOnboardingState(onboardingState));
  if (!onboardingState?.profileWizardCompleted) {
    store.dispatch(setShowProfileWizard(true));
  }
}

/** Try to restore a previous session from IndexedDB */
export async function tryRestoreSession(): Promise<boolean> {
  const raw = await getUserState<MultiAccountSession | LegacySession>("session");
  if (!raw) return false;

  let pubkey: string;
  let signerType: SignerType;

  if (isMultiAccountSession(raw)) {
    // Multi-account format
    const active = raw.accounts.find((a) => a.pubkey === raw.activePubkey) ?? raw.accounts[0];
    if (!active) return false;
    pubkey = active.pubkey;
    signerType = active.signerType;
    // Sync accounts list to Redux
    store.dispatch(setAccounts(raw.accounts));
  } else {
    // Legacy format — migrate
    const legacy = raw as LegacySession;
    if (!legacy.pubkey || !legacy.signerType) return false;
    pubkey = legacy.pubkey;
    signerType = legacy.signerType;

    // Migrate session format
    const accounts: AccountEntry[] = [
      { pubkey, signerType, addedAt: Date.now() },
    ];
    await saveUserState("session", { accounts, activePubkey: pubkey } satisfies MultiAccountSession);
    store.dispatch(setAccounts(accounts));

    // Migrate un-prefixed IndexedDB keys to per-account
    setActivePubkey(pubkey);
    await migrateUnprefixedState(pubkey);
  }

  // Set active pubkey for IndexedDB key prefixing
  setActivePubkey(pubkey);

  const factoryType: "nip07" | "tauri" =
    signerType === "nip07" ? "nip07" : "tauri";

  // Verify the signer is still available
  if (factoryType === "nip07") {
    if (typeof window === "undefined" || !("nostr" in window) || !window.nostr) {
      return false;
    }
  } else {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return false;
    }
  }

  try {
    await performLogin(factoryType, pubkey);
    return true;
  } catch {
    return false;
  }
}

/** Switch to a different stored account */
export async function switchAccount(targetPubkey: string): Promise<void> {
  const session = await getUserState<MultiAccountSession>("session");
  if (!session) throw new Error("No session found");
  const account = session.accounts.find((a) => a.pubkey === targetPubkey);
  if (!account) throw new Error("Account not found");

  // Prevent login screen flash during switch
  store.dispatch(setSwitchingAccount(true));

  try {
    // 1. Run cleanup (cancels timers, unsubs listeners, clears caches, disconnects relays)
    performCleanup();

    // 2. Switch keystore if Tauri account
    if (account.signerType === "tauri_keystore") {
      await TauriSigner.switchAccount(targetPubkey);
    }

    // 3. Set new activePubkey BEFORE resetAll so any IndexedDB reads during
    //    reset use the correct account prefix (not null/stale)
    setActivePubkey(targetPubkey);

    // 4. Reset Redux store AFTER activePubkey is set
    store.dispatch(resetAll());

    // 5. Update session
    session.activePubkey = targetPubkey;
    await saveUserState("session", session);

    // 6. Login as the new account
    const factoryType: "nip07" | "tauri" =
      account.signerType === "nip07" ? "nip07" : "tauri";
    await performLogin(factoryType, targetPubkey);
  } finally {
    store.dispatch(setSwitchingAccount(false));
  }
}

/** Remove a specific account. If it's the last one, full logout. */
export async function removeAccount(pubkeyToRemove: string): Promise<void> {
  const session = await getUserState<MultiAccountSession>("session");
  if (!session) return;

  const remaining = session.accounts.filter((a) => a.pubkey !== pubkeyToRemove);

  // Clear the removed account's IndexedDB data
  await clearAccountState(pubkeyToRemove);

  // Delete the keystore key if Tauri
  const account = session.accounts.find((a) => a.pubkey === pubkeyToRemove);
  if (account?.signerType === "tauri_keystore") {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("keystore_delete_key", { pubkey: pubkeyToRemove });
    } catch {
      // Key may already be deleted
    }
  }

  if (remaining.length === 0) {
    // Last account — full logout
    await performLogout();
    return;
  }

  // Switch to another account
  session.accounts = remaining;
  if (session.activePubkey === pubkeyToRemove) {
    session.activePubkey = remaining[0].pubkey;
  }
  await saveUserState("session", session);

  // If we removed the active account, switch
  if (store.getState().identity.pubkey === pubkeyToRemove) {
    await switchAccount(remaining[0].pubkey);
  } else {
    // Just update the accounts list
    store.dispatch(setAccounts(remaining));
  }
}

/** Internal cleanup: everything performLogout does except clearing session.
 *  Does NOT reset Redux or set activePubkey — caller controls ordering. */
export function performCleanup(): void {
  // 1. FLUSH pending saves while activePubkey still points to the old account.
  //    This persists read state, DM state, etc. so they survive the switch.
  flushDMSave();
  flushDMReadStateSave();
  flushFollowerSave();
  flushFriendRequestSave();
  flushNotificationSave();

  // 2. Unsubscribe persistence listeners
  cleanupDMPersistence?.();
  cleanupDMPersistence = null;
  cleanupDMReadState?.();
  cleanupDMReadState = null;
  cleanupFollowerPersistence?.();
  cleanupFollowerPersistence = null;
  cleanupFriendRequestPersistence?.();
  cleanupFriendRequestPersistence = null;
  cleanupNotificationPersistence?.();
  cleanupNotificationPersistence = null;

  cleanupActiveSpacePersistence?.();
  cleanupActiveSpacePersistence = null;

  // 3. Close subscriptions and background chat subs
  subscriptionManager.closeAll();
  stopAllBgChatSubs();

  // 4. Clear module-level caches (signer, profile, DM relay, channel, dedup, authorSet)
  currentSigner = null;
  profileCache.clear();
  clearDMRelayCache();
  clearLastChannelCache();
  resetEventPipelineCaches();
  verifyBridge.drainPending();

  // 5. Clear subscription state (EOSE timestamps are account-specific)
  clearAllSubscriptions().catch(() => {});

  // 6. Disconnect relays
  relayManager.disconnectAll();
}

/** Full logout: stop listeners, close subscriptions, clear caches, reset store */
export async function performLogout(): Promise<void> {
  // 1. Cancel pending debounce timers FIRST to prevent stale writes
  cancelDMSave();
  cancelDMReadStateSave();
  cancelFollowerSave();
  cancelFriendRequestSave();
  cancelNotificationSave();

  // 2. Stop persistence listeners
  cleanupDMPersistence?.();
  cleanupDMPersistence = null;
  cleanupDMReadState?.();
  cleanupDMReadState = null;
  cleanupFollowerPersistence?.();
  cleanupFollowerPersistence = null;
  cleanupFriendRequestPersistence?.();
  cleanupFriendRequestPersistence = null;
  cleanupNotificationPersistence?.();
  cleanupNotificationPersistence = null;
  cleanupActiveSpacePersistence?.();
  cleanupActiveSpacePersistence = null;

  // 3. Close all relay subscriptions and background chat subs
  subscriptionManager.closeAll();
  stopAllBgChatSubs();

  // 4. Clear signer and module-level caches
  currentSigner = null;
  profileCache.clear();
  clearDMRelayCache();
  clearLastChannelCache();
  resetEventPipelineCaches();
  verifyBridge.drainPending();
  setActivePubkey(null);

  // 5. Disconnect relays
  relayManager.disconnectAll();

  // 6. Clear keystore active pubkey (so next login generates fresh)
  try {
    await TauriSigner.clearActive();
  } catch {
    // Not in Tauri environment, or keystore unavailable
  }

  // 7. Clear IndexedDB — AWAIT so data is gone before next login
  await Promise.all([
    clearAllUserState().catch(() => {}),
    clearAllSubscriptions().catch(() => {}),
  ]);

  // 8. Reset entire Redux store (all 17+ slices → initialState)
  store.dispatch(resetAll());
}
