// Space-meta cache thunks — hydrate a space's stored detail/channels/roster
// into spaceMetaSlice and write it back through the StorageAdapter
// (space_meta store; per-account DB when logged in, app DB for guests — the
// threads.ts pattern). One row per space id, value { savedAt, fetchedAt,
// detail, channels, memberPubkeys } so pruning can evict the stalest rows
// without parsing payloads. The my-spaces list persists under user_state
// ("spaces.mySpaces") — a per-identity list, not a per-space row.

import {
  fetchMySpaces,
  fetchSpaceChannels,
  fetchSpaceDetail,
  fetchSpaceMembers,
  type MySpace,
  type SpaceChannel,
  type SpaceDetail,
  type SpaceMembersResult,
} from "@/lib/api/spaces";
import type { AppThunk } from "@/store";
import { profilesHydrated } from "./slices/profilesSlice";
import {
  PERSIST_ROSTER_CAP,
  SPACE_META_CAP,
  SPACE_META_STALE_SEC,
  mySpacesFetchFailed,
  mySpacesFetchStarted,
  mySpacesFetchSucceeded,
  mySpacesHydrated,
  mySpacesInvalidated,
  spaceMetaFetchFailed,
  spaceMetaFetchStarted,
  spaceMetaFetchSucceeded,
  spaceMetaHydrated,
  spaceMetaInvalidated,
  type SpaceMetaEntry,
  type SpaceMetaHydrateEntry,
} from "./slices/spaceMetaSlice";

interface SpaceMetaRow {
  savedAt: number;
  fetchedAt: number;
  detail: SpaceDetail | null;
  channels: SpaceChannel[] | null;
  memberPubkeys: string[];
}

interface MySpacesRow {
  savedAt: number;
  spaces: MySpace[];
}

const MY_SPACES_KEY = "spaces.mySpaces";

/** How long ensureSpaceMeta waits out a fetch another caller owns. */
const ENSURE_WAIT_MS = 8000;
const ENSURE_POLL_MS = 50;

export function hydrateSpaceMeta(spaceId: string): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    if (getState().spaceMeta.hydrated[spaceId]) return;
    let entry: SpaceMetaHydrateEntry | null = null;
    try {
      const stored = await adapters.storage
        .getStore<SpaceMetaRow>("space_meta")
        .get(spaceId);
      if (stored && typeof stored === "object") {
        entry = {
          detail:
            stored.detail && typeof stored.detail === "object"
              ? stored.detail
              : null,
          channels: Array.isArray(stored.channels) ? stored.channels : null,
          memberPubkeys: Array.isArray(stored.memberPubkeys)
            ? stored.memberPubkeys.filter((p): p is string => typeof p === "string")
            : [],
          fetchedAt: typeof stored.fetchedAt === "number" ? stored.fetchedAt : 0,
        };
      }
    } catch {
      // corrupt row / fresh device — hydrate empty; loadSpaceMeta rebuilds
    }
    dispatch(spaceMetaHydrated({ spaceId, entry }));
  };
}

export function loadSpaceMeta(
  spaceId: string,
  opts?: { force?: boolean },
): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    const entry = getState().spaceMeta.bySpace[spaceId];
    // In-flight status gate — replaces spaceCache's through() promise dedup.
    if (entry && (entry.status === "loading" || entry.status === "refreshing")) return;
    const now = Math.floor(Date.now() / 1000);
    if (!opts?.force && entry && entry.fetchedAt >= now - SPACE_META_STALE_SEC) return;

    dispatch(spaceMetaFetchStarted({ spaceId }));
    let detail: SpaceDetail;
    let channels: SpaceChannel[];
    let members: SpaceMembersResult;
    try {
      // Today's per-call failure tolerance: detail is required (throws),
      // channels/members degrade to empty.
      [detail, channels, members] = await Promise.all([
        fetchSpaceDetail(spaceId),
        fetchSpaceChannels(spaceId).catch(() => [] as SpaceChannel[]),
        fetchSpaceMembers(spaceId).catch(
          (): SpaceMembersResult => ({ pubkeys: [], profiles: {} }),
        ),
      ]);
    } catch (e) {
      dispatch(
        spaceMetaFetchFailed({
          spaceId,
          error: e instanceof Error ? e.message : "Space unavailable.",
        }),
      );
      return;
    }

    // Inline backend profiles seed the store so facepiles paint without a
    // relay round trip — centralizes the per-screen seeding; newest-
    // created_at-wins keeps relay kind-0 authority (profilesSlice upsert).
    if (Object.keys(members.profiles).length > 0) {
      dispatch(profilesHydrated(members.profiles));
    }
    dispatch(
      spaceMetaFetchSucceeded({
        spaceId,
        detail,
        channels,
        memberPubkeys: members.pubkeys,
        fetchedAt: Math.floor(Date.now() / 1000),
      }),
    );

    // Write-through, read back from the slice: the empty read doubles as
    // the identity-switch valve — spaceMetaCleared fires before the account
    // DB swap, the success reducer no-ops on the missing entry, and this
    // write no-ops instead of landing in the next account's DB (threads.ts).
    const current = getState().spaceMeta.bySpace[spaceId];
    if (!current || current.detail === null) return;
    try {
      const store = adapters.storage.getStore<SpaceMetaRow>("space_meta");
      await store.put(spaceId, {
        savedAt: Date.now(),
        fetchedAt: current.fetchedAt,
        detail: current.detail,
        channels: current.channels,
        memberPubkeys: current.memberPubkeys.slice(0, PERSIST_ROSTER_CAP),
      });

      // Prune stalest rows past the cap, never a currently-joined space
      // (row count stays small — getAll is fine; threads.ts pattern).
      const keys = await store.getAllKeys();
      if (keys.length > SPACE_META_CAP) {
        const joined = new Set(
          (getState().spaceMeta.mySpaces ?? []).map((s) => s.id),
        );
        const rows = await Promise.all(
          keys.map(async (key) => ({ key, row: await store.get(key) })),
        );
        rows
          .filter(({ key }) => key !== spaceId && !joined.has(key))
          .sort((a, b) => (a.row?.savedAt ?? 0) - (b.row?.savedAt ?? 0))
          .slice(0, keys.length - SPACE_META_CAP)
          .forEach(({ key }) => {
            store.delete(key).catch(() => {});
          });
      }
    } catch {
      // best-effort — a missing row only costs one skeleton later
    }
  };
}

/** Imperative consumers (session effects, sheets, the space-signal channel
 *  directory): hydrate, load, hand back the entry. When another caller owns
 *  the in-flight fetch (status gate), wait it out briefly so callers get
 *  data instead of the in-flight shell — spaceCache's shared promise gave
 *  them that for free. */
export function ensureSpaceMeta(
  spaceId: string,
): AppThunk<Promise<SpaceMetaEntry | undefined>> {
  return async (dispatch, getState) => {
    await dispatch(hydrateSpaceMeta(spaceId));
    await dispatch(loadSpaceMeta(spaceId));
    let entry = getState().spaceMeta.bySpace[spaceId];
    const deadline = Date.now() + ENSURE_WAIT_MS;
    while (
      entry &&
      (entry.status === "loading" || entry.status === "refreshing") &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, ENSURE_POLL_MS));
      entry = getState().spaceMeta.bySpace[spaceId];
    }
    return entry;
  };
}

/** Join/leave: mark the space AND the joined list stale, then refresh both
 *  in the background — warm data stays on screen while it lands. */
export function invalidateSpaceMeta(spaceId: string): AppThunk {
  return (dispatch) => {
    dispatch(spaceMetaInvalidated({ spaceId }));
    dispatch(mySpacesInvalidated());
    void dispatch(loadSpaceMeta(spaceId, { force: true }));
    void dispatch(loadMySpaces({ force: true }));
  };
}

export function hydrateMySpaces(): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    if (getState().spaceMeta.mySpacesHydrated) return;
    let spaces: MySpace[] | null = null;
    try {
      const stored = await adapters.storage
        .getStore<MySpacesRow>("user_state")
        .get(MY_SPACES_KEY);
      if (stored && Array.isArray(stored.spaces)) {
        spaces = stored.spaces.filter(
          (s) => !!s && typeof s.id === "string" && typeof s.name === "string",
        );
      }
    } catch {
      // fresh device — nothing to hydrate
    }
    dispatch(mySpacesHydrated({ spaces }));
  };
}

export function loadMySpaces(opts?: { force?: boolean }): AppThunk<Promise<void>> {
  return async (dispatch, getState, { adapters }) => {
    const meta = getState().spaceMeta;
    if (meta.mySpacesStatus === "loading" || meta.mySpacesStatus === "refreshing") {
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    if (!opts?.force && meta.mySpacesFetchedAt >= now - SPACE_META_STALE_SEC) return;

    dispatch(mySpacesFetchStarted());
    const signer = adapters.signer;
    if (!signer) {
      // Guest: no joined spaces is the truthful answer, not an error. No
      // persistence either — the app DB must not shadow a later login.
      dispatch(mySpacesFetchSucceeded({ spaces: [], fetchedAt: now }));
      return;
    }
    try {
      const spaces = await fetchMySpaces(signer);
      dispatch(
        mySpacesFetchSucceeded({ spaces, fetchedAt: Math.floor(Date.now() / 1000) }),
      );
    } catch {
      dispatch(mySpacesFetchFailed());
      return;
    }

    // Read back through the slice — the success reducer's status guard is
    // the identity valve (spaceMetaCleared → "idle" → late resolve ignored),
    // so a stale identity's list never lands in the next account's DB.
    const current = getState().spaceMeta;
    if (current.mySpaces === null || current.mySpacesFetchedAt === 0) return;
    await adapters.storage
      .getStore<MySpacesRow>("user_state")
      .put(MY_SPACES_KEY, { savedAt: Date.now(), spaces: current.mySpaces })
      .catch(() => {});
  };
}
