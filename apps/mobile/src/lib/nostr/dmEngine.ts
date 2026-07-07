// ─── Mobile DM engine (NIP-17 over @thewired/core crypto) ────────────
// Owns the persistent kind-1059 gift-wrap subscription, unwrap → dmSlice
// routing, SQLite persistence (hydrate-before-network), and the send path.
// Crypto comes exclusively from @thewired/core (giftWrap/nip44) driven by the
// platform SignerAdapter — never forked here.
//
// PRIVACY: decrypted rumor plaintext exists only in Redux + the local
// dm_messages store. It must never be logged (no console.* in this file
// touches content) and never re-published.

import {
  KIND_GIFT_WRAP,
  buildRumor,
  createGiftWrappedDM,
  createSelfWrap,
  unwrapGiftWrap,
  type GiftWrapContext,
} from "@thewired/core";
import { nip19 } from "nostr-tools";

import type { KVStore, PlatformAdapters } from "@/core/adapters";
import { parseDMRelayTags } from "./relayUrl";
import type { AppDispatch, RootState } from "@/store";
import {
  dmCleared,
  dmConversationRemoved,
  dmHydrated,
  dmMessageReceived,
  dmSendResolved,
  dmSendStarted,
  type DMMessage,
} from "@/store/slices/dmSlice";
import type { NostrEvent, NostrFilter, UnsignedEvent } from "@thewired/shared-types";

export const DM_SUB = "dm-wraps";

/** NIP-17 randomizes seal/wrap created_at up to 2 days into the past, so the
 *  fresh-`since` resubscribe must look back further than the watermark or
 *  wraps created while we were connected — but stamped "2 days ago" — vanish.
 *  Desktop (loginFlow step 7g) uses the same 2d + 1d-skew buffer. */
export const GIFT_WRAP_LOOKBACK_SEC = 3 * 24 * 60 * 60;
/** First login: no watermark — pull a bounded backlog instead of everything. */
const FIRST_SYNC_LIMIT = 100;
/** Newest-message count kept per conversation in SQLite. */
const PERSIST_PER_PEER = 300;
const SEND_TIMEOUT_MS = 10_000;
const PEER_RELAY_FETCH_TIMEOUT_MS = 4000;
const ONE_SHOT_TIMEOUT_MS = 6000;

const HEX64_RE = /^[0-9a-f]{64}$/i;
const WATERMARK_KEY = "lastGiftWrapEose";
const RELAY_LIST_CHECKED_KEY = "dmRelayListChecked";

interface StoredDMMessage {
  partnerPubkey: string;
  message: DMMessage;
}

export interface DmEngineDeps {
  adapters: PlatformAdapters;
  dispatch: AppDispatch;
  getState: () => RootState;
  pool: {
    subscribe(subId: string, filters: NostrFilter[]): void;
    unsubscribe(subId: string): void;
    publish(event: NostrEvent): void;
  };
  /** The engine's resting relay set (peer relays outside it get a one-shot socket). */
  relays: string[];
  /** The engine's one-shot query (REQ → EOSE → events). */
  fetchEvents(filters: NostrFilter[], timeoutMs?: number): Promise<NostrEvent[]>;
}

export interface DmEngine {
  /** Hydrate persisted conversations, then open the gift-wrap sub. */
  start(pubkey: string): Promise<void>;
  /** Account switch / logout: close the sub and clear decrypted state. */
  stop(): void;
  /** A verified kind-1059 from the pool. */
  handleWrapEvent(event: NostrEvent): void;
  /** Returns true when the EOSE belonged to the DM sub (watermark advanced). */
  handleEose(subId: string): boolean;
  /** OK frames — resolves pending sends. */
  handleOk(eventId: string, accepted: boolean): void;
  /** Foreground: reopen the sub with a fresh since (watermark − lookback). */
  handleForeground(): void;
  sendDM(recipient: string, content: string): Promise<void>;
  /** Block flow: drop the conversation from Redux + SQLite. */
  removeConversation(peerPubkey: string): Promise<void>;
  destroy(): void;
}

/** Resolve an npub or 64-hex string to a hex pubkey (throws user-readable). */
export function resolveHexPubkey(input: string): string {
  const trimmed = input.trim();
  if (HEX64_RE.test(trimmed)) return trimmed.toLowerCase();
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type === "npub") return decoded.data;
    if (decoded.type === "nprofile") return decoded.data.pubkey;
  } catch {
    // fall through
  }
  throw new Error("Enter an npub or 64-character hex pubkey.");
}

export function createDmEngine(deps: DmEngineDeps): DmEngine {
  const { adapters, dispatch, getState, pool, relays, fetchEvents } = deps;

  let myPubkey: string | null = null;
  let started = false;
  /** Unix seconds of the last DM-sub EOSE (persisted; drives fresh-`since`). */
  let watermark: number | null = null;

  const sendWaiters = new Map<
    string,
    { partnerPubkey: string; selfWrapId: string; timer: ReturnType<typeof setTimeout> }
  >();

  const messagesStore = (): KVStore<StoredDMMessage> =>
    adapters.storage.getStore("dm_messages");
  const stateStore = (): KVStore<number | boolean> => adapters.storage.getStore("dm_state");

  function subscribeWraps(): void {
    if (!myPubkey) return;
    const filter: NostrFilter = { kinds: [KIND_GIFT_WRAP], "#p": [myPubkey] };
    if (watermark && watermark > 0) {
      filter.since = watermark - GIFT_WRAP_LOOKBACK_SEC;
    } else {
      filter.limit = FIRST_SYNC_LIMIT;
    }
    pool.subscribe(DM_SUB, [filter]);
  }

  async function hydrate(): Promise<void> {
    try {
      const [stored, wm] = await Promise.all([
        messagesStore().getAll(),
        stateStore().get(WATERMARK_KEY),
      ]);
      if (typeof wm === "number") watermark = wm;

      const messagesByPeer: Record<string, DMMessage[]> = {};
      for (const entry of stored) {
        if (!entry?.partnerPubkey || !entry.message) continue;
        (messagesByPeer[entry.partnerPubkey] ??= []).push(entry.message);
      }
      for (const list of Object.values(messagesByPeer)) {
        list.sort((a, b) => a.createdAt - b.createdAt);
      }
      dispatch(dmHydrated({ messagesByPeer }));
      pruneStoredMessages(messagesByPeer).catch(() => {});
    } catch {
      // fresh device / corrupt cache — live sub rebuilds conversations
      dispatch(dmHydrated({ messagesByPeer: {} }));
    }
  }

  /** Bound the per-peer persisted history (newest PERSIST_PER_PEER kept). */
  async function pruneStoredMessages(byPeer: Record<string, DMMessage[]>): Promise<void> {
    for (const [peer, list] of Object.entries(byPeer)) {
      if (list.length <= PERSIST_PER_PEER) continue;
      const evict = list.slice(0, list.length - PERSIST_PER_PEER);
      for (const msg of evict) {
        await messagesStore().delete(`${peer}:${msg.wrapId}`);
      }
    }
  }

  function persistMessage(partnerPubkey: string, message: DMMessage): void {
    messagesStore()
      .put(`${partnerPubkey}:${message.wrapId}`, { partnerPubkey, message })
      .catch(() => {});
  }

  /** Publish our own kind-10050 DM relay list once, and only when the account
   *  doesn't already have one anywhere we can see (read-modify-write guard:
   *  an existing list — e.g. curated on desktop — is never overwritten). */
  async function ensureDmRelayList(): Promise<void> {
    const signer = adapters.signer;
    if (!signer || !myPubkey) return;
    try {
      const checked = await stateStore().get(RELAY_LIST_CHECKED_KEY);
      if (checked) return;

      const own = myPubkey;
      const existing = (
        await fetchEvents(
          [{ kinds: [10050], authors: [own], limit: 1 }],
          PEER_RELAY_FETCH_TIMEOUT_MS,
        )
      ).filter((e) => e.pubkey === own && e.kind === 10050); // filters are relay-controlled
      if (existing.length > 0) {
        await stateStore().put(RELAY_LIST_CHECKED_KEY, true);
        return;
      }
      // Empty could mean "offline" rather than "none" — only trust it when at
      // least one relay is actually connected.
      const anyConnected = Object.values(getState().relays.statuses).some(
        (status) => status === "connected",
      );
      if (!anyConnected) return;

      const unsigned: UnsignedEvent = {
        pubkey: myPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: 10050,
        tags: relays.map((url) => ["relay", url]),
        content: "",
      };
      const signed = await signer.signEvent(unsigned);
      pool.publish(signed);
      await stateStore().put(RELAY_LIST_CHECKED_KEY, true);
    } catch {
      // best-effort — retried next start
    }
  }

  async function handleUnwrapped(event: NostrEvent): Promise<void> {
    const signer = adapters.signer;
    if (!signer || !myPubkey) return;

    // Fail closed: any unwrap/parse error drops the wrap silently.
    const dm = await unwrapGiftWrap(signer, event);

    // Corrupted-decrypt guards (mirrors desktop handleGiftWrap).
    if (!dm.sender || !HEX64_RE.test(dm.sender) || !Array.isArray(dm.tags)) return;

    // Typed wraps (friend requests, call signaling, dm_edit/delete) are not
    // 1:1 messages — those flows land in later phases. Don't render them as
    // garbled conversations.
    if (dm.tags.some((t) => t[0] === "type" && t[1])) return;

    const isOwnMessage = dm.sender === myPubkey;
    const partnerPubkey = isOwnMessage
      ? (dm.tags.find((t) => t[0] === "p" && t[1] !== myPubkey)?.[1] ?? dm.sender)
      : dm.sender;
    if (!HEX64_RE.test(partnerPubkey) || (partnerPubkey === myPubkey && !isOwnMessage)) {
      return;
    }

    // Blocked peers: their content must actually disappear (App Store 1.2).
    if (!isOwnMessage && getState().moderation.mutedPubkeys[dm.sender]) return;

    const message: DMMessage = {
      id: dm.wrapId,
      senderPubkey: dm.sender,
      content: dm.content,
      createdAt: dm.createdAt,
      wrapId: dm.wrapId,
      rumorId: dm.rumorId,
      ...(isOwnMessage ? { status: "sent" as const } : null),
    };

    // Skip when already known (optimistic insert / hydration) — avoids a
    // pointless SQLite write for every relay echo.
    const known = getState().dm.processedWrapIdSet[dm.wrapId];
    dispatch(dmMessageReceived({ partnerPubkey, myPubkey, message }));
    if (!known) persistMessage(partnerPubkey, message);
  }

  /** One-shot socket to a peer DM relay outside our resting set: dial,
   *  publish, await OK, close (battery rule: never grows the resting pool). */
  function publishToRelayOnce(url: string, event: NostrEvent, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let ws;
      try {
        ws = adapters.ws.create(url);
      } catch {
        resolve(false);
        return;
      }
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // already closed
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      ws.onopen = () => ws.send(JSON.stringify(["EVENT", event]));
      ws.onerror = () => finish(false);
      ws.onclose = () => finish(false);
      ws.onmessage = (m) => {
        try {
          const frame = JSON.parse(String(m.data)) as unknown[];
          if (frame[0] === "OK" && frame[1] === event.id) finish(frame[2] === true);
        } catch {
          // ignore malformed frames
        }
      };
    });
  }

  function resolveSend(recipientWrapId: string, ok: boolean): void {
    const waiter = sendWaiters.get(recipientWrapId);
    if (!waiter) return;
    sendWaiters.delete(recipientWrapId);
    clearTimeout(waiter.timer);
    dispatch(
      dmSendResolved({ partnerPubkey: waiter.partnerPubkey, wrapId: waiter.selfWrapId, ok }),
    );
  }

  return {
    async start(pubkey: string): Promise<void> {
      myPubkey = pubkey;
      started = true;
      await hydrate();
      subscribeWraps();
      ensureDmRelayList().catch(() => {});
    },

    stop(): void {
      if (!started) return;
      started = false;
      myPubkey = null;
      watermark = null;
      pool.unsubscribe(DM_SUB);
      for (const waiter of sendWaiters.values()) clearTimeout(waiter.timer);
      sendWaiters.clear();
      dispatch(dmCleared());
    },

    handleWrapEvent(event: NostrEvent): void {
      if (!started || !myPubkey) return;
      // Only wraps addressed to us — our own sends' recipient wraps bounce
      // back from relays but can't be decrypted with our key.
      const recipient = event.tags.find((t) => t[0] === "p")?.[1];
      if (recipient !== myPubkey) return;
      handleUnwrapped(event).catch(() => {
        // fail closed — undecryptable/forged wraps are dropped
      });
    },

    handleEose(subId: string): boolean {
      if (subId !== DM_SUB) return false;
      // EOSE = the relay's stored backlog is drained: safe to advance the
      // watermark to now (the lookback covers randomized timestamps + skew).
      watermark = Math.floor(Date.now() / 1000);
      stateStore().put(WATERMARK_KEY, watermark).catch(() => {});
      return true;
    },

    handleOk(eventId: string, accepted: boolean): void {
      if (sendWaiters.has(eventId)) resolveSend(eventId, accepted);
    },

    handleForeground(): void {
      if (!started || !myPubkey) return;
      // iOS killed the sockets while suspended — reopen with a fresh since so
      // wraps received server-side during suspension backfill.
      subscribeWraps();
    },

    async sendDM(recipient: string, content: string): Promise<void> {
      const signer = adapters.signer;
      if (!signer || !myPubkey) throw new Error("Sign in to send messages.");
      const trimmed = content.trim();
      if (!trimmed) throw new Error("Write a message first.");
      const recipientPubkey = resolveHexPubkey(recipient);
      if (recipientPubkey === myPubkey) throw new Error("That's you.");

      const ctx: GiftWrapContext = { myPubkey, signer };
      // One shared rumor → both wraps carry the same rumorId (edit/delete anchor).
      const rumor = await buildRumor(myPubkey, recipientPubkey, trimmed);
      const { wrap: recipientWrap } = await createGiftWrappedDM(
        ctx,
        trimmed,
        recipientPubkey,
        undefined,
        rumor,
      );
      const { wrap: selfWrap } = await createSelfWrap(
        ctx,
        trimmed,
        recipientPubkey,
        undefined,
        rumor,
      );

      // Optimistic insert (real send time from the rumor), persisted so a
      // kill+relaunch mid-flight keeps the message (as failed → resend).
      const message: DMMessage = {
        id: selfWrap.id,
        senderPubkey: myPubkey,
        content: trimmed,
        createdAt: rumor.created_at,
        wrapId: selfWrap.id,
        rumorId: rumor.id,
        status: "pending",
      };
      dispatch(dmSendStarted({ partnerPubkey: recipientPubkey, message }));
      persistMessage(recipientPubkey, message);

      const timer = setTimeout(() => resolveSend(recipientWrap.id, false), SEND_TIMEOUT_MS);
      sendWaiters.set(recipientWrap.id, {
        partnerPubkey: recipientPubkey,
        selfWrapId: selfWrap.id,
        timer,
      });

      // Our relay set carries both wraps (bootstrap overlap covers most peers)…
      pool.publish(recipientWrap);
      pool.publish(selfWrap);

      // …plus the peer's own kind-10050 inbox relays when fetchable. At most
      // ONE extra socket, closed right after the OK (guide 06 §3).
      fetchEvents(
        [{ kinds: [10050], authors: [recipientPubkey], limit: 1 }],
        PEER_RELAY_FETCH_TIMEOUT_MS,
      )
        .then(async (events) => {
          const newest = events
            .filter((e) => e.pubkey === recipientPubkey && e.kind === 10050)
            .sort((a, b) => b.created_at - a.created_at)[0];
          if (!newest) return;
          const extra = parseDMRelayTags(newest.tags).filter((url) => !relays.includes(url));
          if (extra.length === 0) return;
          const delivered = await publishToRelayOnce(extra[0], recipientWrap, ONE_SHOT_TIMEOUT_MS);
          if (delivered) resolveSend(recipientWrap.id, true);
        })
        .catch(() => {});
    },

    async removeConversation(peerPubkey: string): Promise<void> {
      dispatch(dmConversationRemoved(peerPubkey));
      try {
        const keys = await messagesStore().getAllKeys();
        for (const key of keys) {
          if (key.startsWith(`${peerPubkey}:`)) await messagesStore().delete(key);
        }
      } catch {
        // best-effort cleanup
      }
    },

    destroy(): void {
      for (const waiter of sendWaiters.values()) clearTimeout(waiter.timer);
      sendWaiters.clear();
      started = false;
    },
  };
}
