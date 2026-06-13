import { store } from "@/store";
import { setRelayList } from "@/store/slices/identitySlice";
import { setDisabledRelays } from "@/store/slices/relaysSlice";
import { getUserState, saveUserState } from "../db/userStateStore";
import { relayManager } from "./relayManager";
import { normalizeRelayUrl } from "./relayUrl";
import { buildRelayListEvent } from "./eventBuilder";
import { signAndPublish } from "./publish";
import { BOOTSTRAP_RELAYS, INDEXER_RELAYS } from "./constants";
import type { RelayListEntry } from "../../types/relay";

/** IndexedDB user-state key for the locally-disabled relay set (per-account). */
const DISABLED_KEY = "relay_disabled";

/** Load the persisted disabled-relay set and apply it to Redux + relayManager.
 *  Called at login (before any user-list connect) so disabled relays are never
 *  dialed during startup. */
export async function loadAndApplyDisabledRelays(): Promise<string[]> {
  const stored = await getUserState<string[]>(DISABLED_KEY);
  const urls = (stored ?? [])
    .map((u) => normalizeRelayUrl(u))
    .filter((u): u is string => !!u);
  store.dispatch(setDisabledRelays(urls));
  relayManager.setUserDisabledRelays(urls);
  return urls;
}

/** Toggle a relay's local-only disabled state. Applies immediately: persists
 *  per-account, disconnects/reconnects the relay. Does NOT touch the published
 *  NIP-65 list — disabled relays stay published; use publishRelayList to edit
 *  that. */
export async function setRelayDisabled(url: string, disabled: boolean): Promise<void> {
  const k = normalizeRelayUrl(url);
  if (!k) return;

  const current = store.getState().relays.disabledRelays;
  const next = disabled
    ? current.includes(k) ? current : [...current, k]
    : current.filter((u) => u !== k);

  store.dispatch(setDisabledRelays(next));
  relayManager.setUserDisabledRelays(next);
  await saveUserState(DISABLED_KEY, next);

  if (disabled) {
    relayManager.disconnect(k);
  } else {
    const entry = store.getState().identity.relayList.find(
      (r) => normalizeRelayUrl(r.url) === k,
    );
    relayManager.connect(k, entry?.mode ?? "read+write");
  }
}

/** Publish the user's NIP-65 relay list (kind:10002) and reconcile live
 *  connections to match. Optimistic Redux update with rollback, mirroring the
 *  kind:3 pattern in follow.ts. */
export async function publishRelayList(newEntries: RelayListEntry[]): Promise<void> {
  const state = store.getState();
  const pubkey = state.identity.pubkey;
  if (!pubkey) throw new Error("Not logged in");

  // Normalize + dedupe (last entry wins for duplicate URLs).
  const byUrl = new Map<string, RelayListEntry>();
  for (const e of newEntries) {
    const url = normalizeRelayUrl(e.url);
    if (url) byUrl.set(url, { url, mode: e.mode });
  }
  const entries = [...byUrl.values()];
  if (entries.length === 0) {
    throw new Error("Refusing to publish an empty relay list");
  }

  // GUARD: refuse to publish before the login-time kind:10002 query has
  // resolved — publishing early would clobber the user's real list with the
  // local seed. The login flow sets a createdAt:1 sentinel once relays have
  // been checked and none was found (new user), which unblocks this.
  if (state.identity.relayListCreatedAt === 0) {
    throw new Error("Relay list not yet synced from relays — try again in a moment");
  }

  const prev = state.identity.relayList;
  const now = Math.floor(Date.now() / 1000);

  // Publish targets: old + new write relays (so just-removed relays receive
  // the superseding list and don't serve a stale one), bootstrap, and the
  // NIP-65 indexers (purplepag.es / user.kindpag.es accept kind:10002 — it's
  // their specialty). publish() silently drops targets with no live
  // connection, so dial missing ones read-only first.
  const writeUrls = (list: RelayListEntry[]) =>
    list
      .filter((r) => r.mode === "write" || r.mode === "read+write")
      .map((r) => normalizeRelayUrl(r.url))
      .filter((u): u is string => !!u);
  const disabled = new Set(state.relays.disabledRelays);
  const targets = [
    ...new Set([
      ...writeUrls(prev),
      ...writeUrls(entries),
      ...BOOTSTRAP_RELAYS.map((u) => normalizeRelayUrl(u) ?? u),
      ...INDEXER_RELAYS.map((u) => normalizeRelayUrl(u) ?? u),
    ]),
  ].filter((u) => !disabled.has(u));
  for (const t of targets) {
    if (!relayManager.getAllConnections().has(t)) {
      relayManager.connect(t, "read");
    }
  }

  // Optimistic update so the settings UI reflects the save immediately.
  store.dispatch(setRelayList({ entries, createdAt: now }));

  try {
    const unsigned = buildRelayListEvent(pubkey, entries);
    // Publish BEFORE reconciling: reconcile disconnects removed relays, and
    // they must still receive the superseding event.
    await signAndPublish(unsigned, targets);
  } catch (err) {
    // Rollback with the NEW timestamp: setRelayList's freshness guard is
    // strict `<`, so restoring with the old createdAt would silently no-op.
    store.dispatch(setRelayList({ entries: prev, createdAt: now }));
    throw err;
  }

  await saveUserState("relay_list", entries);
  relayManager.reconcileUserRelays(entries, { pruneBootstrap: true });
}
