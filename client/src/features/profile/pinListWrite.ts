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
  newerOf,
  pinnedIdsFromTags,
  sameTags,
  type PinOp,
} from "./pinList";

/**
 * Writing the pin list (kind:10001) — read-modify-write against the
 * FRESHEST relay copy, never against the ids held in Redux:
 *
 *   fetch the newest 10001 → apply the tap to its tags (everything else kept
 *   verbatim, including an encrypted private half) → publish with created_at
 *   past the copy it replaces → adopt it, or throw so the caller rolls back.
 *
 * A replaceable write erases whatever it omits, so a list rebuilt from a
 * stale or not-yet-loaded copy wipes pins made on another device. Hence:
 * no relay answered → no publish. Taps run one at a time so a quick second
 * tap builds on the first one's result.
 */

const FETCH_TIMEOUT_MS = 6_000;
/** After the first EOSE, how long the slower relays get to answer. */
const EOSE_GRACE_MS = 800;

function pinRelays(): string[] {
  const urls = [APP_RELAY, ...relayManager.getWriteRelays().map((c) => c.url)];
  return [...new Set(urls.map((u) => normalizeRelayUrl(u) ?? u))];
}

/** One-shot read of `pubkey`'s newest kind:10001. `answered` = at least one
 *  relay sent EOSE — without it, "no list" means "unknown", not "empty". */
export function fetchLatestPinList(
  pubkey: string,
  relayUrls: string[] = pinRelays(),
): Promise<{ event: NostrEvent | null; answered: boolean }> {
  return new Promise((resolve) => {
    let best: NostrEvent | null = null;
    let answered = false;
    let eoses = 0;
    let done = false;
    let subId: string | null = null;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const timer = setTimeout(() => finish(), FETCH_TIMEOUT_MS);
    function finish() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      if (subId) relayManager.closeSubscription(subId);
      resolve({ event: best, answered });
    }
    subId = relayManager.subscribe({
      filters: [{ kinds: [PIN_LIST_KIND], authors: [pubkey], limit: 1 }],
      relayUrls,
      onEvent: (event: NostrEvent) => {
        if (event.kind !== PIN_LIST_KIND || event.pubkey !== pubkey) return;
        if (!best || isNewerEvent(event, best)) best = event;
      },
      onEOSE: () => {
        answered = true;
        eoses++;
        // Every relay we asked has answered — done. Otherwise give the
        // slower ones a moment (the manager may have merged or skipped urls,
        // so "all of them" can't be counted on).
        if (eoses >= relayUrls.length) finish();
        else grace ??= setTimeout(finish, EOSE_GRACE_MS);
      },
    });
    // A relay that answered synchronously finished before the id existed.
    if (done) relayManager.closeSubscription(subId);
  });
}

/** The last list this session published — relays can lag behind it. */
let lastPublished: NostrEvent | null = null;
let chain: Promise<unknown> = Promise.resolve();

/** Pin or unpin one note on `pubkey`'s profile. Resolves once a relay took
 *  the new list (Redux + the local cache adopt it); rejects when nothing was
 *  published, so the caller can roll its optimistic state back. */
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

async function applyPinUpdate(pubkey: string, op: PinOp): Promise<void> {
  const stillOwn = () => store.getState().identity.pubkey === pubkey;
  const { event: fetched, answered } = await fetchLatestPinList(pubkey);
  if (!stillOwn()) throw new Error("Account changed while updating pins");
  if (!fetched && !answered) throw new Error("No relay answered — pins left unchanged");

  const base = newerOf(fetched, lastPublished?.pubkey === pubkey ? lastPublished : null);
  const baseTags = base?.tags ?? [];
  const tags = applyPinOps(baseTags, [op], APP_RELAY);
  if (base && sameTags(tags, baseTags)) {
    adopt(base); // already true on the relays (pinned on another device)
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedEvent = {
    pubkey,
    // A replaceable event must be NEWER than the one it replaces.
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
  const results = await relayManager.publishWithConfirmation(signed, pinRelays());
  if (!results.some((r) => r.success)) {
    throw new Error("No relay accepted the pin list");
  }
  lastPublished = signed;
  if (stillOwn()) adopt(signed);
}

/** Tests only. */
export function __resetPinListWriteForTest(): void {
  lastPublished = null;
  chain = Promise.resolve();
}
