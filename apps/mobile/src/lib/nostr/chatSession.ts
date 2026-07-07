// ─── Per-screen space chat session ───────────────────────────────────
// Connects the space's hostRelay ON DEMAND for one ChannelScreen: a single
// socket (its own one-relay pool — backoff + REQ replay reused), a kind-9
// #h subscription, verify-then-route, and membership-gated posting. The
// socket is closed when the screen unmounts — the resting set never grows
// past the 3 bootstrap sockets (guide 06 §3).
//
// Channel routing mirrors the desktop indexIntoChatChannel contract: an
// explicit ["channel", id] tag scopes a message to that channel; untagged
// messages belong to the space's default chat channel.

import type { NostrEvent, NostrFilter, UnsignedEvent } from "@thewired/shared-types";

import { createRelayPool, type RelayPool } from "./relayPool";
import type { PlatformAdapters } from "@/core/adapters";

const CHAT_SUB = "space-chat";
const CHAT_KIND = 9;
const BACKLOG_LIMIT = 60;
const PUBLISH_TIMEOUT_MS = 10_000;

export interface ChatSessionDeps {
  adapters: PlatformAdapters;
  relayUrl: string;
  spaceId: string;
  channelId: string;
  /** True when this channel is the space's default chat channel — untagged
   *  (legacy) messages route here. */
  isDefaultChannel: boolean;
  onMessage(event: NostrEvent): void;
  onStatus?(status: string): void;
}

export interface ChatSession {
  /** Sign + publish a kind-9 to the host relay. Resolves true on OK; rejects
   *  with the relay's reason when membership rules refuse it. */
  post(content: string): Promise<boolean>;
  /** Foreground catch-up: re-REQ the backlog window. */
  resubscribe(): void;
  destroy(): void;
}

/** Does this event belong in the given channel? Exported for tests. */
export function matchesChannel(
  event: NostrEvent,
  spaceId: string,
  channelId: string,
  isDefaultChannel: boolean,
): boolean {
  if (event.kind !== CHAT_KIND) return false;
  if (event.tags.find((t) => t[0] === "h")?.[1] !== spaceId) return false;
  const channelTag = event.tags.find((t) => t[0] === "channel")?.[1];
  if (channelTag) return channelTag === channelId;
  return isDefaultChannel;
}

export function createChatSession(deps: ChatSessionDeps): ChatSession {
  const { adapters, relayUrl, spaceId, channelId, isDefaultChannel } = deps;
  const seen = new Set<string>();
  const okWaiters = new Map<
    string,
    { resolve: (ok: boolean) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  async function route(event: NostrEvent): Promise<void> {
    if (seen.has(event.id)) return;
    seen.add(event.id);
    let valid = false;
    try {
      valid = await adapters.verifier.verify(event);
    } catch {
      valid = false;
    }
    if (!valid) return; // fail closed
    if (!matchesChannel(event, spaceId, channelId, isDefaultChannel)) return;
    deps.onMessage(event);
  }

  /** NIP-42: the platform relay gates group-chat reads behind AUTH. Logged-in
   *  users sign the kind-22242 challenge; guests can't — whatever the relay
   *  serves unauthenticated is what they browse (relay-side policy). */
  async function answerAuthChallenge(challenge: string): Promise<void> {
    const signer = adapters.signer;
    if (!signer) return;
    const signed = await signer.signEvent({
      pubkey: await signer.getPublicKey(),
      created_at: Math.floor(Date.now() / 1000),
      kind: 22242,
      tags: [
        ["relay", relayUrl],
        ["challenge", challenge],
      ],
      content: "",
    });
    pool.auth(signed, relayUrl);
    // Re-REQ once the relay has processed the AUTH — replaces this sub's
    // filters server-side, now with the authenticated read set.
    setTimeout(subscribe, 400);
  }

  const pool: RelayPool = createRelayPool(adapters.ws, {
    onEvent: (_subId, event) => {
      route(event).catch(() => {});
    },
    onEose: () => {},
    onStatus: (_url, status) => deps.onStatus?.(status),
    onAuth: (challenge) => {
      answerAuthChallenge(challenge).catch(() => {});
    },
    onOk: (eventId, accepted, message) => {
      const waiter = okWaiters.get(eventId);
      if (!waiter) return;
      okWaiters.delete(eventId);
      clearTimeout(waiter.timer);
      if (accepted) waiter.resolve(true);
      else waiter.reject(new Error(message || "The relay refused this message."));
    },
  });

  function subscribe(): void {
    const filter: NostrFilter = { kinds: [CHAT_KIND], "#h": [spaceId], limit: BACKLOG_LIMIT };
    pool.subscribe(CHAT_SUB, [filter]);
  }

  pool.connect([relayUrl]);
  subscribe();

  return {
    async post(content: string): Promise<boolean> {
      const signer = adapters.signer;
      if (!signer) throw new Error("Sign in to post.");
      const trimmed = content.trim();
      if (!trimmed) throw new Error("Write something first.");

      const tags: string[][] = [["h", spaceId]];
      if (!isDefaultChannel) tags.push(["channel", channelId]);
      const unsigned: UnsignedEvent = {
        pubkey: await signer.getPublicKey(),
        created_at: Math.floor(Date.now() / 1000),
        kind: CHAT_KIND,
        tags,
        content: trimmed,
      };
      const signed = await signer.signEvent(unsigned);

      const confirmation = new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => {
          okWaiters.delete(signed.id);
          reject(new Error("No reply from the space relay."));
        }, PUBLISH_TIMEOUT_MS);
        okWaiters.set(signed.id, { resolve, reject, timer });
      });
      pool.publish(signed);
      const ok = await confirmation;
      // Optimistic echo — the relay accepted it; render without waiting for
      // the subscription round trip (dedup by id if it echoes back).
      route(signed).catch(() => {});
      return ok;
    },

    resubscribe(): void {
      pool.reconnectNow();
      subscribe();
    },

    destroy(): void {
      for (const waiter of okWaiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("closed"));
      }
      okWaiters.clear();
      pool.destroy();
    },
  };
}
