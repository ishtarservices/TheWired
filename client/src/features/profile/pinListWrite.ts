import { store } from "@/store";
import { setPinnedNotes } from "@/store/slices/identitySlice";
import { relayManager } from "@/lib/nostr/relayManager";
import { APP_RELAY } from "@/lib/nostr/constants";
import { normalizeRelayUrl } from "@/lib/nostr/relayUrl";
import { signWithAccount } from "@/lib/nostr/publish";
import { saveUserState } from "@/lib/db/userStateStore";
import type { NostrEvent, UnsignedEvent } from "@/types/nostr";
import {
  PIN_LIST_KIND,
  applyPinOps,
  isNewerEvent,
  isTrustedPinList,
  newerOf,
  pinnedIdsFromTags,
  sameTags,
  type PinOp,
} from "./pinList";

/**
 * Writing the pin list (kind:10001) — read-modify-write against the
 * FRESHEST copy, never against the ids held in Redux:
 *
 *   read the newest verified 10001 from every relay the list lives on (the
 *   copy seen at login and this session's last publish count too) → apply
 *   the tap to its tags (everything else kept verbatim, including an
 *   encrypted private half) → publish with created_at past the copy it
 *   replaces, to the relays that answered the read → adopt it, or throw so
 *   the caller rolls back.
 *
 * A replaceable write erases whatever it omits, so a list rebuilt from a
 * stale or not-yet-loaded copy wipes pins made on another device. Hence:
 * - the read waits for every relay it asked (until the timeout) instead of
 *   settling on the first fast, empty answer;
 * - a relay that never answered is not written to: its copy is unknown;
 * - no relay answered → no publish; an unpin with nothing to remove → no
 *   publish (never an empty list);
 * - taps run one at a time, so a quick second tap builds on the first.
 */

const FETCH_TIMEOUT_MS = 6_000;

/** Where the list lives: the app relay, the user's NIP-65 write relays
 *  (connected yet or not — the subscription dials them), and any other
 *  connected write relay. */
function pinRelays(): string[] {
  const own = store
    .getState()
    .identity.relayList.filter((r) => r.mode === "write" || r.mode === "read+write")
    .map((r) => r.url);
  const urls = [APP_RELAY, ...own, ...relayManager.getWriteRelays().map((c) => c.url)];
  return [...new Set(urls.map((u) => normalizeRelayUrl(u) ?? u))];
}

/** One-shot read of `pubkey`'s newest trusted kind:10001. `answered` lists
 *  the relays that sent EOSE — without any, "no list" means "unknown", not
 *  "empty". Settles when every relay asked has answered, or at the timeout. */
export function fetchLatestPinList(
  pubkey: string,
  relayUrls: string[] = pinRelays(),
): Promise<{ event: NostrEvent | null; answered: string[] }> {
  return new Promise((resolve) => {
    let best: NostrEvent | null = null;
    const answered = new Set<string>();
    const asked = new Set(relayUrls.map((u) => normalizeRelayUrl(u) ?? u));
    let done = false;
    let subId: string | null = null;
    const timer = setTimeout(() => finish(), FETCH_TIMEOUT_MS);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (subId) relayManager.closeSubscription(subId);
      resolve({ event: best, answered: [...answered] });
    }
    subId = relayManager.subscribe({
      filters: [{ kinds: [PIN_LIST_KIND], authors: [pubkey], limit: 1 }],
      relayUrls,
      onEvent: (event: NostrEvent) => {
        if (!isTrustedPinList(event, pubkey)) return;
        if (!best || isNewerEvent(event, best)) best = event;
      },
      onEOSE: (_subId: string, relayUrl: string) => {
        // Distinct relays: a reconnect re-sends the REQ, and its second EOSE
        // must not count as another relay answering.
        answered.add(normalizeRelayUrl(relayUrl) ?? relayUrl);
        if ([...asked].every((u) => answered.has(u))) finish();
      },
    });
    // A relay that answered synchronously finished before the id existed.
    if (done) relayManager.closeSubscription(subId);
  });
}

/** The last list this session published — relays can lag behind it. */
let lastPublished: NostrEvent | null = null;
/** The newest trusted copy seen anywhere else (the login subscription). */
let lastSeen: NostrEvent | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Record a copy of the user's own list seen outside a write (the login
 *  subscription), so a write whose read misses it still builds on it.
 *  Returns false for a copy that must not be used at all. */
export function notePinListSeen(event: NostrEvent, pubkey: string): boolean {
  if (!isTrustedPinList(event, pubkey)) return false;
  if (!lastSeen || lastSeen.pubkey !== pubkey || isNewerEvent(event, lastSeen)) lastSeen = event;
  return true;
}

/** Pin or unpin one note on `pubkey`'s profile. Resolves once a relay took
 *  the new list (Redux + the local cache adopt it) or the list already says
 *  so; rejects when nothing was published, so the caller can roll its
 *  optimistic state back. */
export function updatePinnedNotes(pubkey: string, op: PinOp): Promise<void> {
  const run = chain.then(() => applyPinUpdate(pubkey, op));
  chain = run.catch(() => {});
  return run;
}

function adopt(event: NostrEvent): void {
  const noteIds = pinnedIdsFromTags(event.tags);
  store.dispatch(setPinnedNotes({ noteIds, createdAt: event.created_at }));
  void saveUserState("pinned_notes", noteIds);
}

function ownCopy(event: NostrEvent | null, pubkey: string): NostrEvent | null {
  return event && event.pubkey === pubkey ? event : null;
}

async function applyPinUpdate(pubkey: string, op: PinOp): Promise<void> {
  const stillOwn = () => store.getState().identity.pubkey === pubkey;
  const { event: fetched, answered } = await fetchLatestPinList(pubkey);
  if (!stillOwn()) throw new Error("Account changed while updating pins");
  if (answered.length === 0) throw new Error("No relay answered — pins left unchanged");

  const base = newerOf(
    newerOf(fetched, ownCopy(lastPublished, pubkey)),
    ownCopy(lastSeen, pubkey),
  );
  const baseTags = base?.tags ?? [];
  const tags = applyPinOps(baseTags, [op], APP_RELAY);
  if (sameTags(tags, baseTags)) {
    // Already true (pinned on another device), or an unpin of something no
    // list holds: nothing to publish — never an empty list.
    if (base) adopt(base);
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedEvent = {
    pubkey,
    // A replaceable event must be NEWER than the one it replaces. The base
    // is at most MAX_FUTURE_SEC ahead (isTrustedPinList), so this is bounded.
    created_at: Math.max(now, (base?.created_at ?? 0) + 1),
    kind: PIN_LIST_KIND,
    tags,
    // Another client's private items ride along untouched.
    content: base?.content ?? "",
  };
  const signed = await signWithAccount(unsigned);
  if (!stillOwn() || signed.pubkey !== pubkey) {
    throw new Error("Account changed while updating pins");
  }
  // Only the relays that answered: one that didn't may hold a copy this
  // write never saw, and overwriting it there would drop those pins.
  const results = await relayManager.publishWithConfirmation(signed, answered);
  if (!results.some((r) => r.success)) {
    throw new Error("No relay accepted the pin list");
  }
  lastPublished = signed;
  if (stillOwn()) adopt(signed);
}

/** Tests only. */
export function __resetPinListWriteForTest(): void {
  lastPublished = null;
  lastSeen = null;
  chain = Promise.resolve();
}
