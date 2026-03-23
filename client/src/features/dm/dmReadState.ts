import { store } from "@/store";
import { applyRelayReadState } from "@/store/slices/dmSlice";
import { nip44Encrypt, nip44Decrypt } from "@/lib/nostr/nip44";
import { signAndPublish } from "@/lib/nostr/publish";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { BOOTSTRAP_RELAYS } from "@/lib/nostr/constants";
import { EVENT_KINDS } from "@/types/nostr";
import type { UnsignedEvent, NostrEvent } from "@/types/nostr";

const D_TAG = "thewired:dm_read_state";
const PUBLISH_DEBOUNCE_MS = 10_000;

let publishTimer: ReturnType<typeof setTimeout> | null = null;

function getRelayUrls(): string[] {
  const dmRelays = store.getState().identity.dmRelayList;
  return dmRelays.length > 0
    ? [...new Set([...dmRelays, ...BOOTSTRAP_RELAYS])]
    : [...BOOTSTRAP_RELAYS];
}

/**
 * Fetch NIP-78 DM read state from relays, decrypt, and merge into Redux.
 * Should be called after loadDMState() but before DM subscription starts.
 */
export function loadDMReadState(): void {
  const pubkey = store.getState().identity.pubkey;
  if (!pubkey) return;

  const subId = subscriptionManager.subscribe({
    filters: [
      {
        kinds: [EVENT_KINDS.APP_SPECIFIC_DATA],
        authors: [pubkey],
        "#d": [D_TAG],
        limit: 1,
      },
    ],
    relayUrls: getRelayUrls(),
    onEOSE: () => {
      // Event was processed through the pipeline and stored via addEvent.
      // Find it in the Redux entity adapter and decrypt.
      decryptAndApplyReadState(pubkey);
      subscriptionManager.close(subId);
    },
  });
}

/** Find the NIP-78 read state event in Redux, decrypt, and apply */
async function decryptAndApplyReadState(pubkey: string): Promise<void> {
  const eventsState = store.getState().events;
  const allEvents = Object.values(eventsState.entities).filter(Boolean) as NostrEvent[];
  const readStateEvent = allEvents.find(
    (e) =>
      e.kind === EVENT_KINDS.APP_SPECIFIC_DATA &&
      e.pubkey === pubkey &&
      e.tags.some((t) => t[0] === "d" && t[1] === D_TAG),
  );

  if (!readStateEvent) return;

  try {
    const plaintext = await nip44Decrypt(pubkey, readStateEvent.content);
    const parsed = JSON.parse(plaintext) as { lastRead?: Record<string, number> };
    if (parsed.lastRead && typeof parsed.lastRead === "object") {
      store.dispatch(applyRelayReadState(parsed.lastRead));
    }
  } catch {
    // Decryption or parse failure — stale/corrupt event, ignore
  }
}

/** Publish the current read state to relays */
async function publishReadState(): Promise<void> {
  const state = store.getState();
  const pubkey = state.identity.pubkey;
  if (!pubkey) return;

  const lastRead = state.dm.lastReadTimestamps;
  if (Object.keys(lastRead).length === 0) return;

  const plaintext = JSON.stringify({ lastRead });
  const encrypted = await nip44Encrypt(pubkey, plaintext);

  const unsigned: UnsignedEvent = {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: EVENT_KINDS.APP_SPECIFIC_DATA,
    tags: [["d", D_TAG]],
    content: encrypted,
  };

  await signAndPublish(unsigned, getRelayUrls());
}

function schedulePublishReadState(): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishReadState().catch(() => {});
  }, PUBLISH_DEBOUNCE_MS);
}

/**
 * Watch Redux for conversation read events and debounce-publish to relays.
 * Returns an unsubscribe function.
 */
export function startDMReadStateSync(): () => void {
  let lastTimestamps = store.getState().dm.lastReadTimestamps;

  const unsubscribe = store.subscribe(() => {
    const current = store.getState().dm.lastReadTimestamps;
    if (current !== lastTimestamps) {
      lastTimestamps = current;
      schedulePublishReadState();
    }
  });

  return unsubscribe;
}
