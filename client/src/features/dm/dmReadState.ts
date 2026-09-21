// The kind-30078 `thewired:dm_read_state` record (docs/DM_WIRE_CONTRACT.md §6):
// read cursors + pin / archive / mute / disappearing timer, NIP-44 to self,
// merged (never overwritten) via @ishtarservices/core's read-state helpers so
// desktop and mobile converge on the same record.

import { store } from "@/store";
import { applyReadStateRecord } from "@/store/slices/dmSlice";
import { nip44Encrypt, nip44Decrypt } from "@/lib/nostr/nip44";
import { signAndPublish } from "@/lib/nostr/publish";
import { subscriptionManager } from "@/lib/nostr/subscriptionManager";
import { BOOTSTRAP_RELAYS } from "@/lib/nostr/constants";
import { EVENT_KINDS } from "@/types/nostr";
import {
  DM_READ_STATE_D_TAG,
  decodeDMReadState,
  encodeDMReadState,
  emptyDMReadState,
  mergeDMReadState,
} from "@ishtarservices/core";
import type { DMReadStateRecordV2 } from "@ishtarservices/shared-types";
import type { UnsignedEvent, NostrEvent } from "@/types/nostr";

const D_TAG = DM_READ_STATE_D_TAG;
const PUBLISH_DEBOUNCE_MS = 10_000;

let publishTimer: ReturnType<typeof setTimeout> | null = null;
/** The newest record we know the relays hold (merged on every load). */
let remoteRecord: DMReadStateRecordV2 = emptyDMReadState();

function getRelayUrls(): string[] {
  const dmRelays = store.getState().identity.dmRelayList;
  return dmRelays.length > 0
    ? [...new Set([...dmRelays, ...BOOTSTRAP_RELAYS])]
    : [...BOOTSTRAP_RELAYS];
}

/** The record as Redux currently sees it. */
function localRecord(): DMReadStateRecordV2 {
  const dm = store.getState().dm;
  return {
    v: 2,
    lastRead: { ...dm.lastReadTimestamps },
    pinned: { ...dm.flags.pinned },
    archived: { ...dm.flags.archived },
    muted: { ...dm.flags.muted },
    expireAfter: { ...dm.flags.expireAfter },
    updatedAt: dm.flags.updatedAt,
  };
}

/**
 * Fetch the NIP-78 DM read state from relays, decrypt, merge into Redux.
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

/** Find the NIP-78 read state event in Redux, decrypt, merge, apply. */
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

  const decoded = await decodeDMReadState({ nip44Decrypt }, pubkey, readStateEvent.content);
  if (!decoded) return; // stale/corrupt event — ignore
  remoteRecord = mergeDMReadState(remoteRecord, decoded);
  store.dispatch(applyReadStateRecord(remoteRecord));
}

/** Publish the merged read state to relays. */
async function publishReadState(): Promise<void> {
  const state = store.getState();
  const pubkey = state.identity.pubkey;
  if (!pubkey) return;

  // Merge, never overwrite: another device's pins/mutes survive our publish.
  const merged = mergeDMReadState(remoteRecord, localRecord());
  if (
    Object.keys(merged.lastRead).length === 0 &&
    Object.keys(merged.pinned).length === 0 &&
    Object.keys(merged.archived).length === 0 &&
    Object.keys(merged.muted).length === 0 &&
    Object.keys(merged.expireAfter).length === 0
  ) {
    return;
  }
  merged.updatedAt = Math.floor(Date.now() / 1000);
  const encrypted = await encodeDMReadState({ nip44Encrypt }, pubkey, merged);

  const unsigned: UnsignedEvent = {
    pubkey,
    created_at: merged.updatedAt,
    kind: EVENT_KINDS.APP_SPECIFIC_DATA,
    tags: [["d", D_TAG]],
    content: encrypted,
  };

  await signAndPublish(unsigned, getRelayUrls());
  remoteRecord = merged;
}

/** Cancel any pending debounced publish without publishing */
export function cancelPendingSave(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
  }
  remoteRecord = emptyDMReadState();
}

/** Flush any pending read state publish immediately (fire-and-forget) */
export function flushPendingSave(): void {
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
    publishReadState().catch(() => {});
  }
}

function schedulePublishReadState(): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishReadState().catch(() => {});
  }, PUBLISH_DEBOUNCE_MS);
}

/**
 * Watch Redux for read-cursor / flag changes and debounce-publish to relays.
 * Returns an unsubscribe function.
 */
export function startDMReadStateSync(): () => void {
  let lastTimestamps = store.getState().dm.lastReadTimestamps;
  let lastFlags = store.getState().dm.flags;

  const unsubscribe = store.subscribe(() => {
    const dm = store.getState().dm;
    if (dm.lastReadTimestamps !== lastTimestamps || dm.flags !== lastFlags) {
      lastTimestamps = dm.lastReadTimestamps;
      lastFlags = dm.flags;
      schedulePublishReadState();
    }
  });

  return unsubscribe;
}
