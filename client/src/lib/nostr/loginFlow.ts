import { store } from "../../store";
import {
  login,
  setProfile,
  setRelayList,
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
import { EVENT_KINDS } from "../../types/nostr";
import { saveUserState, getUserState } from "../db/userStateStore";
import { loadSpaces } from "../db/spaceStore";
import { loadMusicLibrary } from "../db/musicStore";
import { getEventsByKind } from "../db/eventStore";
import { setSpaces } from "../../store/slices/spacesSlice";
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
import { BOOTSTRAP_RELAYS } from "./constants";
import { profileCache } from "./profileCache";

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

  // Step 7: Subscribe for user metadata from bootstrap relays
  subscribeUserData(pubkey, BOOTSTRAP_RELAYS);

  // Step 7b: Load spaces from IndexedDB
  const savedSpaces = await loadSpaces();
  if (savedSpaces.length > 0) {
    store.dispatch(setSpaces(savedSpaces));
  }

  // Step 7c: Load music events from IndexedDB
  const [trackEvents, albumEvents, playlistEvents] = await Promise.all([
    getEventsByKind(EVENT_KINDS.MUSIC_TRACK, 500),
    getEventsByKind(EVENT_KINDS.MUSIC_ALBUM, 200),
    getEventsByKind(EVENT_KINDS.MUSIC_PLAYLIST, 200),
  ]);
  if (trackEvents.length > 0) {
    const tracks = trackEvents.map(parseTrackEvent);
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
  if (albumEvents.length > 0) {
    store.dispatch(addAlbums(albumEvents.map(parseAlbumEvent)));
  }
  if (playlistEvents.length > 0) {
    store.dispatch(addPlaylists(playlistEvents.map(parsePlaylistEvent)));
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

  // Step 7e: Subscribe for user's own music events from relays
  // Events flow through processIncomingEvent → Redux + IndexedDB persistence
  subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.MUSIC_TRACK, EVENT_KINDS.MUSIC_ALBUM, EVENT_KINDS.MUSIC_PLAYLIST],
        authors: [pubkey],
        limit: 500,
      },
    ],
    relayUrls: BOOTSTRAP_RELAYS,
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
  relayManager.disconnectAll();
  saveUserState("session", null);
}
