// ─── Space-level live chat signal ─────────────────────────────────────
// Live kind-9 previews + unread evidence for the SpacesHome channel list
// WITHOUT entering a channel: ONE fixed sub id on the ENGINE pool covering
// every joined space hosted on the app relay, in one multi-space `#h`
// filter. The filter changes only when the joined set changes — never on
// space switching or screen focus (the APP_RELAY sub-cap incident: minimize
// REQ churn). Foreign-hostRelay (decentralized) spaces are out of scope
// here — their previews still come from ChannelScreen visits (honest
// degradation is the designed row state).
//
// Trust boundary: the REQ is relay-targeted at the app relay only (public
// relays don't enforce `#h` membership — a broadcast REQ would let anyone
// spoof preview rows) and handleEvent drops events sourced elsewhere.
// The app relay gates kind-9 reads behind NIP-42; the engine answers the
// challenge and calls handleAuthed() → this module re-REQs so the sub runs
// under the authenticated read set. Guests (no signer) never subscribe.

import type { NostrEvent, NostrFilter } from "@thewired/shared-types";

import type { RelayPool } from "./relayPool";
import { normalizeRelayUrl } from "./relayUrl";
import type { SpaceChannel } from "@/lib/api/spaces";
import type { PlatformAdapters } from "@/core/adapters";
import type { AppDispatch, RootState } from "@/store";
import {
  channelPreviewsUpserted,
  type ChannelMessageSeen,
} from "@/store/slices/spacePreviewsSlice";

export const SPACE_SIGNAL_SUB = "space-signal";
/** Backfill window — rebuilds unread evidence after cold start (previews are
 *  in-memory; lastReadAt persists). Older messages undercount, never phantom. */
export const SIGNAL_BACKLOG_SEC = 48 * 3600;
export const SIGNAL_LIMIT = 300;
/** Overlap on watermark resubscribes — clock-skew tolerance (engine parity). */
const RESUB_OVERLAP_SEC = 60;
/** Post-AUTH re-REQ delay — the relay processes AUTH first (chatSession). */
const REAUTH_RESUB_DELAY_MS = 400;
const FLUSH_MS = 50;
const UNTAGGED_BUFFER_CAP = 20;
const SEEN_CAP = 2000;
/** Future-dated events must not drag the resubscribe watermark forward past
 *  real traffic — tolerate modest skew only. */
const WATERMARK_SKEW_CAP_SEC = 300;

export interface SpaceSignalDeps {
  adapters: PlatformAdapters;
  dispatch: AppDispatch;
  getState: () => RootState;
  pool: RelayPool;
  /** DEFAULT_RELAYS[0] — the only relay this sub targets. */
  appRelayUrl: string;
  /** Channel directory source (the space-meta cache via ensureSpaceMeta).
   *  MUST reject when the directory is unavailable — a resolved [] would be
   *  cached as a real "chat"-only directory and misroute untagged events. */
  fetchChannelDirectory: (spaceId: string) => Promise<SpaceChannel[]>;
}

export interface SpaceSignal {
  /** Diff the joined-space set; (re)REQ only when the app-relay subset
   *  actually changed. Foreign-hostRelay spaces are ignored (P1 scope). */
  setSpaces(spaces: Array<{ spaceId: string; hostRelay: string | null }>): void;
  /** True when subId belongs to this module (engine routes to handleEvent). */
  ownsSub(subId: string): boolean;
  handleEvent(event: NostrEvent, relayUrl: string): void;
  /** Engine answered an app-relay AUTH challenge → debounced re-REQ under
   *  the authenticated read set. */
  handleAuthed(): void;
  /** Foreground catch-up: fresh-`since` re-REQ (pool.resume reopened sockets). */
  resubscribe(): void;
  /** Logout/account switch: close the sub + drop all session state. */
  stop(): void;
  destroy(): void;
}

// ─── Pure helpers (exported for tests) ────────────────────────────────

/** Normalize + collapse loopback aliases to one canonical host. localhost,
 *  127.x and [::1] are the same interface — the dev stack's seed rows say
 *  "ws://localhost:7777" while the app relay resolves to "ws://127.0.0.1:7777"
 *  (Metro hostUri), and a textual compare would misfile every dev space as
 *  foreign-hostRelay. Prod urls pass through normalizeRelayUrl untouched. */
export function canonicalRelayUrl(raw: string): string | null {
  const norm = normalizeRelayUrl(raw);
  if (!norm) return null;
  try {
    const url = new URL(norm);
    // Strict IPv4 parse — a hostile hostname like 127.evil.com never aliases.
    const isV4Loopback = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname);
    if (
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1" ||
      isV4Loopback
    ) {
      url.hostname = "127.0.0.1";
    }
    let out = url.toString();
    if (out.endsWith("/") && url.pathname === "/") out = out.slice(0, -1);
    return out;
  } catch {
    return norm;
  }
}

/** Split joined spaces into app-relay-hosted (null hostRelay = app relay,
 *  matching ChannelScreen's fallback) and foreign, grouped by canonical url. */
export function partitionByHost(
  spaces: Array<{ spaceId: string; hostRelay: string | null }>,
  appRelayUrl: string,
): { appRelay: string[]; foreign: Map<string, string[]> } {
  const appNorm = canonicalRelayUrl(appRelayUrl);
  const appRelay: string[] = [];
  const foreign = new Map<string, string[]>();
  for (const space of spaces) {
    if (!space.spaceId) continue;
    const host = space.hostRelay ? canonicalRelayUrl(space.hostRelay) : null;
    if (!host || host === appNorm) {
      appRelay.push(space.spaceId);
    } else {
      const list = foreign.get(host);
      if (list) list.push(space.spaceId);
      else foreign.set(host, [space.spaceId]);
    }
  }
  return { appRelay, foreign };
}

export function buildSignalFilters(
  spaceIds: string[],
  watermark: number | null,
  nowSec: number,
): NostrFilter[] {
  if (spaceIds.length === 0) return [];
  const floor = nowSec - SIGNAL_BACKLOG_SEC;
  const since =
    watermark === null ? floor : Math.max(watermark - RESUB_OVERLAP_SEC, floor);
  return [{ kinds: [9], "#h": spaceIds, since, limit: SIGNAL_LIMIT }];
}

export interface ChannelDirectory {
  /** Known channel ids (incl. the default) — unknown tags are dropped. */
  channelIds: Set<string>;
  defaultChannelId: string;
}

/** Default-channel contract shared with chatSession.matchesChannel and
 *  ChannelScreen: the flagged default chat channel, else the first chat
 *  channel, else "chat" (nativeChatChannel's id for nip29 empty lists). */
export function directoryFromChannels(channels: SpaceChannel[]): ChannelDirectory {
  const chat = channels.filter((c) => c.type === "chat");
  const defaultChannelId = chat.find((c) => c.isDefault)?.id ?? chat[0]?.id ?? "chat";
  const channelIds = new Set(channels.map((c) => c.id));
  channelIds.add(defaultChannelId);
  return { channelIds, defaultChannelId };
}

/** Which channel does this kind-9 belong to? Tagged events route on their
 *  tag (validated against the directory when one is loaded — bounds the
 *  previews map against hostile tags); untagged events need the directory's
 *  default (null = caller buffers until it loads). */
export function attributeChannel(
  event: NostrEvent,
  dir: ChannelDirectory | null,
): string | null {
  const tag = event.tags.find((t) => t[0] === "channel")?.[1];
  if (tag) {
    if (dir && !dir.channelIds.has(tag)) return null;
    return tag;
  }
  return dir ? dir.defaultChannelId : null;
}

// ─── Module ───────────────────────────────────────────────────────────

export function createSpaceSignal(deps: SpaceSignalDeps): SpaceSignal {
  const { adapters, dispatch, getState, pool, appRelayUrl, fetchChannelDirectory } =
    deps;
  const appRelayNorm = canonicalRelayUrl(appRelayUrl);

  let spaceIds: string[] = [];
  let spaceKey = "";
  let subscribed = false;
  let watermark: number | null = null;
  let destroyed = false;

  const seen = new Set<string>();
  const directories = new Map<string, ChannelDirectory>();
  const directoriesInFlight = new Set<string>();
  /** Verified, mute-filtered untagged events awaiting their directory. */
  const untagged = new Map<string, NostrEvent[]>();

  let pending: ChannelMessageSeen[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let reauthTimer: ReturnType<typeof setTimeout> | null = null;

  const nowSec = () => Math.floor(Date.now() / 1000);

  function flush(): void {
    flushTimer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    dispatch(channelPreviewsUpserted(batch));
  }

  function queue(message: ChannelMessageSeen): void {
    pending.push(message);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  function markSeen(id: string): boolean {
    if (seen.has(id)) return false;
    if (seen.size >= SEEN_CAP) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    seen.add(id);
    return true;
  }

  function subscribe(): void {
    if (destroyed) return;
    // Guests can't answer the NIP-42 challenge and the relay serves them
    // nothing for kind-9 — don't burn a REQ.
    if (spaceIds.length === 0 || !adapters.signer) {
      if (subscribed) {
        pool.unsubscribe(SPACE_SIGNAL_SUB);
        subscribed = false;
      }
      return;
    }
    pool.subscribe(SPACE_SIGNAL_SUB, buildSignalFilters(spaceIds, watermark, nowSec()), [
      appRelayUrl,
    ]);
    subscribed = true;
  }

  function accept(event: NostrEvent, spaceId: string, channelId: string): void {
    watermark = Math.max(
      watermark ?? 0,
      Math.min(event.created_at, nowSec() + WATERMARK_SKEW_CAP_SEC),
    );
    queue({
      spaceId,
      channelId,
      eventId: event.id,
      createdAt: event.created_at,
      senderPubkey: event.pubkey,
      content: event.content,
      isOwn: event.pubkey === getState().identity.pubkey,
    });
  }

  function ensureDirectory(spaceId: string): void {
    if (directories.has(spaceId) || directoriesInFlight.has(spaceId)) return;
    directoriesInFlight.add(spaceId);
    // Space-meta cache — SpaceChannelList has usually fetched these
    // already, so this is typically a cache hit, not a network round trip.
    fetchChannelDirectory(spaceId)
      .then((channels) => {
        if (destroyed) return;
        const dir = directoryFromChannels(channels);
        directories.set(spaceId, dir);
        const buffered = untagged.get(spaceId);
        untagged.delete(spaceId);
        if (buffered) {
          for (const event of buffered) {
            const channelId = attributeChannel(event, dir);
            if (channelId) accept(event, spaceId, channelId);
          }
        }
      })
      .catch(() => {
        // Backend unreachable — drop the buffer; the next untagged arrival
        // retries (the directory source rejects instead of caching failures).
        untagged.delete(spaceId);
      })
      .finally(() => {
        directoriesInFlight.delete(spaceId);
      });
  }

  async function handleEventImpl(event: NostrEvent, relayUrl: string): Promise<void> {
    // Defense in depth alongside the targeted REQ: only app-relay traffic.
    if (canonicalRelayUrl(relayUrl) !== appRelayNorm) return;
    if (event.kind !== 9) return;
    const spaceId = event.tags.find((t) => t[0] === "h")?.[1];
    if (!spaceId || !spaceIds.includes(spaceId)) return;
    if (!markSeen(event.id)) return;

    let valid = false;
    try {
      valid = await adapters.verifier.verify(event);
    } catch {
      valid = false;
    }
    if (!valid) return; // fail closed

    // Callers filter muted authors BEFORE dispatching (slice contract).
    if (getState().moderation.mutedPubkeys[event.pubkey]) return;

    const channelId = attributeChannel(event, directories.get(spaceId) ?? null);
    if (channelId) {
      accept(event, spaceId, channelId);
      return;
    }
    if (!event.tags.some((t) => t[0] === "channel")) {
      // Untagged and no directory yet — buffer until it loads.
      const buffer = untagged.get(spaceId) ?? [];
      if (buffer.length < UNTAGGED_BUFFER_CAP) buffer.push(event);
      untagged.set(spaceId, buffer);
      ensureDirectory(spaceId);
    }
    // Tagged-but-unknown with a loaded directory: dropped (hostile tag guard).
  }

  return {
    setSpaces(spaces): void {
      const { appRelay } = partitionByHost(spaces, appRelayUrl);
      const key = [...appRelay].sort().join(",");
      if (key === spaceKey) return;
      spaceKey = key;
      spaceIds = appRelay;
      subscribe();
    },

    ownsSub(subId: string): boolean {
      return subId === SPACE_SIGNAL_SUB;
    },

    handleEvent(event: NostrEvent, relayUrl: string): void {
      handleEventImpl(event, relayUrl).catch(() => {});
    },

    handleAuthed(): void {
      if (!subscribed || destroyed) return;
      if (reauthTimer) clearTimeout(reauthTimer);
      reauthTimer = setTimeout(() => {
        reauthTimer = null;
        subscribe();
      }, REAUTH_RESUB_DELAY_MS);
    },

    resubscribe(): void {
      if (subscribed) subscribe();
    },

    stop(): void {
      if (subscribed) {
        pool.unsubscribe(SPACE_SIGNAL_SUB);
        subscribed = false;
      }
      flush();
      spaceIds = [];
      spaceKey = "";
      watermark = null;
      seen.clear();
      directories.clear();
      directoriesInFlight.clear();
      untagged.clear();
    },

    destroy(): void {
      destroyed = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (reauthTimer) clearTimeout(reauthTimer);
      flushTimer = null;
      reauthTimer = null;
    },
  };
}
