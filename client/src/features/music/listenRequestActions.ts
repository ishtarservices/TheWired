import type { NostrEvent, UnsignedEvent } from "@/types/nostr";
import type { MusicProposal } from "@/types/music";
import type { AppDispatch, RootState } from "@/store";
import type { ResolveOutcome } from "@/lib/api/proposals";
import {
  listenAccessRequested,
  listenAccessRequestForgotten,
  listenRequestRowsResolved,
  listenRequestsFailed,
  listenRequestsHydrated,
  listenRequestsLoaded,
  listenRequestsLoading,
  type ListenRequestRecord,
} from "@/store/slices/musicSlice";
import {
  accessStateFor,
  ownedChildTrackRefs,
  planGrant,
  spaceIdsOf,
  type AccessState,
  type GrantCrypto,
} from "./accessGrant";
import { collapseListenRequests, type ListenRequestGroup } from "./listenRequestInbox";
import { buildListenRequestEvent, parseListenTarget, type ListenTarget } from "./listenRequestWire";

/**
 * Listen-request sequencing against the store. Pure work lives in
 * listenRequestWire / accessGrant / listenRequestInbox; this file wires it to
 * the backend, the signer and the relays through injected deps (the real ones
 * are in listenRequests.ts) so it can be tested without a live app.
 */

export const LISTEN_REQUESTS_STALE_SEC = 60;

export type Thunk<T> = (dispatch: AppDispatch, getState: () => RootState) => Promise<T>;

export interface ListenRequestDeps {
  fetchIncoming(): Promise<MusicProposal[]>;
  resolve(id: string, status: "accepted" | "rejected"): Promise<ResolveOutcome>;
  publish(unsigned: UnsignedEvent, relays?: string[]): Promise<NostrEvent>;
  /** Host relays for space-scoped events (undefined = default write relays). */
  relaysFor(spaceIds: string[]): Promise<string[] | undefined>;
  /** A persisted raw event by id (IndexedDB). */
  loadStoredEvent(eventId: string): Promise<NostrEvent | undefined>;
  /** Newest verified version of an address on the relays, or null. */
  fetchLatest(target: ListenTarget): Promise<NostrEvent | null>;
  crypto(me: string): GrantCrypto;
  readRecords(pubkey: string): Record<string, ListenRequestRecord>;
  writeRecords(pubkey: string, records: Record<string, ListenRequestRecord>): void;
  now(): number;
}

export type GrantOutcome = "granted" | "already-had-access";

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function dTagOf(event: Pick<NostrEvent, "tags">): string {
  return event.tags.find((t) => t[0] === "d")?.[1] ?? "";
}

function matchesTarget(event: NostrEvent, target: ListenTarget): boolean {
  return event.kind === target.kind && event.pubkey === target.ownerPubkey && dTagOf(event) === target.d;
}

/** Is `pubkey` a known member of ANY of `spaceIds` (from loaded member lists)? */
export function isKnownSpaceMember(state: RootState, spaceIds: readonly string[], pubkey: string): boolean {
  if (spaceIds.length === 0) return false;
  const ids = new Set(spaceIds);
  return state.spaces.list.some((sp) => ids.has(sp.id) && (sp.memberPubkeys ?? []).includes(pubkey));
}

/** The raw event behind the store's parsed track/album for `ref`, if still
 *  held in the in-memory entity store (synchronous). */
export function storedTargetEvent(state: RootState, ref: string): NostrEvent | undefined {
  const target = parseListenTarget(ref);
  if (!target) return undefined;
  const parsed = target.kind === 31683 ? state.music.tracks[ref] : state.music.albums[ref];
  if (!parsed?.eventId) return undefined;
  const ev = state.events.entities[parsed.eventId];
  return ev && matchesTarget(ev, target) ? ev : undefined;
}

/**
 * Would granting this request change nothing, judged from data already in
 * memory? "public" (anyone can play it) or "has-access" (author, existing
 * grant, or known space member). Null when it needs the owner, or the target
 * isn't loaded.
 */
export function settledAccessSync(
  state: RootState,
  group: Pick<ListenRequestGroup, "targetRef" | "ownerPubkey" | "proposerPubkey">,
  event: NostrEvent | undefined = storedTargetEvent(state, group.targetRef),
): Extract<AccessState, "public" | "has-access"> | null {
  if (!event || event.pubkey !== group.ownerPubkey) return null;
  const st = accessStateFor(event, group.proposerPubkey, {
    spaceMember: isKnownSpaceMember(state, spaceIdsOf(event), group.proposerPubkey),
  });
  return st === "public" || st === "has-access" ? st : null;
}

export function createListenRequestActions(deps: ListenRequestDeps) {
  let inFlight: Promise<void> | null = null;
  const granting = new Set<string>();

  /** Newest version of one of MY addresses: store / IndexedDB / relays. */
  async function latestOwnEvent(state: RootState, ref: string): Promise<NostrEvent | null> {
    const target = parseListenTarget(ref);
    if (!target) return null;
    const candidates: NostrEvent[] = [];
    const inMemory = storedTargetEvent(state, ref);
    if (inMemory) candidates.push(inMemory);
    else {
      const parsed = target.kind === 31683 ? state.music.tracks[ref] : state.music.albums[ref];
      if (parsed?.eventId) {
        const stored = await deps.loadStoredEvent(parsed.eventId).catch(() => undefined);
        if (stored && matchesTarget(stored, target)) candidates.push(stored);
      }
    }
    // Always ask the relays too: republishing a stale copy would undo an edit
    // made on another device (e.g. tracks added from soot).
    const remote = await deps.fetchLatest(target).catch(() => null);
    if (remote && matchesTarget(remote, target)) candidates.push(remote);
    return candidates.reduce<NostrEvent | null>((best, ev) => (!best || ev.created_at > best.created_at ? ev : best), null);
  }

  /** Resolve every row id; returns those resolved. Throws after a partial run
   *  with the ids done so far attached. */
  async function resolveAll(ids: readonly string[], status: "accepted" | "rejected"): Promise<string[]> {
    const done: string[] = [];
    for (const id of ids) {
      await deps.resolve(id, status);
      done.push(id);
    }
    return done;
  }

  /** Silently accept requests that would change nothing (public target, or the
   *  requester already has access). Returns how many groups were settled. */
  function settleListenRequests(): Thunk<number> {
    return async (dispatch, getState) => {
      const state = getState();
      const me = state.identity.pubkey;
      if (!me) return 0;
      let settled = 0;
      for (const group of collapseListenRequests(state.music.listenRequests.incoming, { me })) {
        let event = storedTargetEvent(state, group.targetRef);
        if (!event) {
          const target = parseListenTarget(group.targetRef);
          const parsed = target?.kind === 31683 ? state.music.tracks[group.targetRef] : state.music.albums[group.targetRef];
          if (parsed?.eventId) event = await deps.loadStoredEvent(parsed.eventId).catch(() => undefined);
        }
        if (!settledAccessSync(state, group, event)) continue;
        try {
          dispatch(listenRequestRowsResolved(await resolveAll(group.rowIds, "accepted")));
          settled += 1;
        } catch {
          // Leave it; the next load tries again.
        }
      }
      return settled;
    };
  }

  /** Fetch the owner's inbox (stale-gated unless `force`), then settle the
   *  requests that need no decision. */
  function loadIncomingListenRequests(force = false): Thunk<void> {
    return async (dispatch, getState) => {
      const me = getState().identity.pubkey;
      if (!me) return;
      const { fetchedAt } = getState().music.listenRequests;
      if (!force && fetchedAt > 0 && fetchedAt >= deps.now() - LISTEN_REQUESTS_STALE_SEC) return;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        dispatch(listenRequestsLoading());
        try {
          const rows = await deps.fetchIncoming();
          if (getState().identity.pubkey !== me) return; // account switched mid-flight
          dispatch(listenRequestsLoaded({ rows, fetchedAt: deps.now() }));
          await dispatch(settleListenRequests());
        } catch (err) {
          dispatch(listenRequestsFailed(message(err, "Couldn't load listen requests.")));
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };
  }

  /**
   * Owner: grant a (collapsed) listen request — republish the target (and a
   * project's owned child tracks) with the requester as a viewer, then resolve
   * every sibling row as accepted. Idempotent: if nothing needs changing it
   * publishes nothing and just resolves.
   */
  function grantListenRequest(group: ListenRequestGroup): Thunk<GrantOutcome> {
    return async (dispatch, getState) => {
      const me = getState().identity.pubkey;
      if (!me || me !== group.ownerPubkey) throw new Error("Only the owner can grant access.");
      if (granting.has(group.key)) throw new Error("Already granting this request.");
      granting.add(group.key);
      try {
        const state = getState();
        const target = await latestOwnEvent(state, group.targetRef);
        if (!target) throw new Error("Couldn't load this release to update it. Try again in a moment.");
        const requester = group.proposerPubkey;
        const isSpaceMember = (ids: string[]) => isKnownSpaceMember(getState(), ids, requester);
        const st = accessStateFor(target, requester, { spaceMember: isSpaceMember(spaceIdsOf(target)) });
        if (st === "space") {
          throw new Error("This release is space exclusive. They need to join the space to listen.");
        }

        let plan: UnsignedEvent[] = [];
        if (st !== "public") {
          const childTracks: NostrEvent[] = [];
          if (target.kind === 33123) {
            for (const ref of ownedChildTrackRefs(target)) {
              const child = await latestOwnEvent(getState(), ref);
              if (child) childTracks.push(child);
            }
          }
          plan = await planGrant({ target, requester, me, childTracks, crypto: deps.crypto(me), isSpaceMember });
        }

        for (const unsigned of plan) {
          const spaces = spaceIdsOf(unsigned);
          await deps.publish(unsigned, spaces.length > 0 ? await deps.relaysFor(spaces) : undefined);
        }

        try {
          await resolveAll(group.rowIds, "accepted");
        } catch {
          if (plan.length > 0) {
            throw new Error("Access granted, but the request couldn't be marked done. It will clear on the next refresh.");
          }
          throw new Error("Couldn't answer this request. Try again.");
        }
        dispatch(listenRequestRowsResolved(group.rowIds));
        return plan.length > 0 ? "granted" : "already-had-access";
      } finally {
        granting.delete(group.key);
      }
    };
  }

  /** Owner: decline = resolve every sibling row as rejected. */
  function declineListenRequest(group: ListenRequestGroup): Thunk<void> {
    return async (dispatch) => {
      try {
        await resolveAll(group.rowIds, "rejected");
      } catch (err) {
        throw new Error(message(err, "Couldn't decline this request. Try again."));
      }
      dispatch(listenRequestRowsResolved(group.rowIds));
    };
  }

  /** Requester: load this account's remembered requests once per account. */
  function hydrateListenAccessRequests(): Thunk<void> {
    return async (dispatch, getState) => {
      const me = getState().identity.pubkey;
      if (!me || getState().music.listenRequests.requestedFor === me) return;
      dispatch(listenRequestsHydrated({ pubkey: me, records: deps.readRecords(me) }));
    };
  }

  /** Requester: publish a listen request for `targetRef` and remember it. */
  function requestListenAccess(targetRef: string): Thunk<void> {
    return async (dispatch, getState) => {
      const me = getState().identity.pubkey;
      if (!me) throw new Error("Sign in to request access.");
      await dispatch(hydrateListenAccessRequests());
      const unsigned = buildListenRequestEvent(me, targetRef);
      const signed = await deps.publish(unsigned);
      if (getState().identity.pubkey !== me) return;
      dispatch(listenAccessRequested({ targetRef, record: { requestedAt: deps.now(), eventId: signed.id } }));
      deps.writeRecords(me, getState().music.listenRequests.requested);
    };
  }

  /** Requester: drop a remembered request (granted, or about to ask again). */
  function forgetListenAccessRequest(targetRef: string): Thunk<void> {
    return async (dispatch, getState) => {
      const me = getState().identity.pubkey;
      if (!me) return;
      dispatch(listenAccessRequestForgotten(targetRef));
      deps.writeRecords(me, getState().music.listenRequests.requested);
    };
  }

  return {
    loadIncomingListenRequests,
    settleListenRequests,
    grantListenRequest,
    declineListenRequest,
    hydrateListenAccessRequests,
    requestListenAccess,
    forgetListenAccessRequest,
  };
}

export type ListenRequestActions = ReturnType<typeof createListenRequestActions>;
