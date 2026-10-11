/**
 * Space-config-changed signal.
 *
 * Platform spaces are backend-authoritative: channels, roles, members and
 * moderation live in Postgres and clients read them over REST. Nothing used
 * to tell a client that another client (or another device) changed something,
 * so a rename on desktop stayed invisible on mobile until a manual refresh
 * (WIR-190 / WIR-196).
 *
 * After every admin mutation the backend now publishes one small event to the
 * platform relay, signed with the ingest identity (INGEST_SECRET_KEY):
 *
 *   kind 20900 (ephemeral range — never meant to be fetched as history)
 *   tags [["d", spaceId], ["what", "channels"], ["what", "roles"], ...]
 *   content ""
 *
 * It carries NO data — only "this space's <what> changed". Clients treat it
 * as a refetch hint and go back to REST, which stays the authority; a forged
 * nudge can at worst cause one extra fetch (clients debounce per space).
 *
 * The `d` tag (not `h`) is deliberate: the relay's membership gate rejects
 * any `h`-tagged publish from a non-member, and the ingest identity is a
 * member of nothing. Clients filter `{kinds:[20900], "#d": joinedIds}`.
 *
 * Bursts coalesce: a role edit that fires "roles" three times inside the
 * window goes out once with the union of `what`s. Publishing is best-effort
 * and never blocks or fails the REST call.
 */
import { finalizeEvent } from "nostr-tools";
import { config } from "../config.js";
import { ingestSecretKeyBytes } from "../workers/relayConnectionManager.js";
import { publishToRelay, type RelayEventRow } from "./platformModeration.js";

export const SPACE_CONFIG_CHANGED_KIND = 20900;

/** What changed, in the vocabulary both clients refetch by. */
export type SpaceChange =
  | "meta" // name / about / picture
  | "channels"
  | "roles" // role rows, permissions, channel overrides
  | "members" // roster or a member's roles
  | "moderation" // bans / mutes
  | "deleted";

export const SPACE_CHANGE_KINDS: readonly SpaceChange[] = [
  "meta",
  "channels",
  "roles",
  "members",
  "moderation",
  "deleted",
];

/** Coalescing window per space. */
export const SPACE_SIGNAL_DEBOUNCE_MS = 250;

export type SpaceSignalEvent = RelayEventRow;

/** Pure: the unsigned shape (exported for tests and the clients' parsers). */
export function buildSpaceSignalTemplate(
  spaceId: string,
  changes: readonly SpaceChange[],
  createdAt = Math.floor(Date.now() / 1000),
): { kind: number; created_at: number; tags: string[][]; content: string } {
  const what = SPACE_CHANGE_KINDS.filter((c) => changes.includes(c));
  return {
    kind: SPACE_CONFIG_CHANGED_KIND,
    created_at: createdAt,
    tags: [["d", spaceId], ...what.map((c) => ["what", c]), ["alt", "The Wired: space settings changed"]],
    content: "",
  };
}

type Publisher = (event: SpaceSignalEvent) => Promise<unknown>;

let publisher: Publisher = (event) => publishToRelay(event, config.relayUrl);
let warnedNoKey = false;

/** Test seam: capture instead of dialing the relay. Returns a restore fn. */
export function setSpaceSignalPublisherForTests(next: Publisher | null): () => void {
  const previous = publisher;
  publisher = next ?? ((event) => publishToRelay(event, config.relayUrl));
  return () => {
    publisher = previous;
  };
}

const pending = new Map<string, { changes: Set<SpaceChange>; timer: ReturnType<typeof setTimeout> }>();

/** Flush one space's pending changes now (tests call this; production waits
 *  out the window). Resolves after the publish attempt settles. */
export async function flushSpaceSignal(spaceId: string): Promise<void> {
  const entry = pending.get(spaceId);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(spaceId);
  await publish(spaceId, [...entry.changes]);
}

async function publish(spaceId: string, changes: SpaceChange[]): Promise<void> {
  const sk = ingestSecretKeyBytes();
  if (!sk) {
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn("[spaceSignal] INGEST_SECRET_KEY not set — space-config-changed nudges are off; clients fall back to refetch-on-focus");
    }
    return;
  }
  try {
    const event = finalizeEvent(buildSpaceSignalTemplate(spaceId, changes), sk) as SpaceSignalEvent;
    await publisher(event);
  } catch (err) {
    console.warn("[spaceSignal] publish failed:", err instanceof Error ? err.message : err);
  }
}

/**
 * Queue a nudge. Fire-and-forget by design: the REST handler that calls this
 * has already committed its write and must answer regardless of the relay.
 */
export function notifySpaceChanged(spaceId: string, change: SpaceChange | SpaceChange[]): void {
  const changes = Array.isArray(change) ? change : [change];
  const existing = pending.get(spaceId);
  if (existing) {
    for (const c of changes) existing.changes.add(c);
    return;
  }
  const timer = setTimeout(() => {
    void flushSpaceSignal(spaceId);
  }, SPACE_SIGNAL_DEBOUNCE_MS);
  // Never keep the process alive for a nudge.
  (timer as { unref?: () => void }).unref?.();
  pending.set(spaceId, { changes: new Set(changes), timer });
}

/** Test-only: drop everything queued. */
export function resetSpaceSignalForTests(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  warnedNoKey = false;
}
