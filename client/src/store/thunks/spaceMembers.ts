import type { AppDispatch, RootState } from "../index";
import { setMembers } from "../slices/spaceConfigSlice";
import { updateSpaceMembers } from "../slices/spacesSlice";
import { fetchAllMemberRoles } from "../../lib/api/roles";
import { saveMembers } from "../../lib/db/spaceMembersStore";
import { ApiRequestError } from "../../lib/api/client";
import { profileCache } from "../../lib/nostr/profileCache";
import { isBackendBacked } from "../../features/spaces/spaceType";
import { createLogger } from "../../lib/debug/logger";

const log = createLogger("spaces");

/**
 * Single source of truth for space membership + roles.
 *
 * Replaces the older two-fetch model (`/spaces/:id/members` + `/spaces/:id/member-roles`).
 * `/member-roles` is a strict superset (it returns members with empty `roles: []` when no
 * explicit role is assigned, and the backend default-assigns on join), so one fetch is
 * enough to update both slices atomically:
 *  - `spaceConfig.members[spaceId]` (full SpaceMember[] with roles)
 *  - `spaces.list[*].memberPubkeys`  (string[] derived from the same fetch)
 *
 * Plus IDB write-through, so a cold reload paints correctly without waiting for refetch.
 */

/** Per-spaceId in-flight promise dedup. Multiple concurrent callers share one fetch. */
const inFlight = new Map<string, Promise<void>>();

/** Test-only: clear the in-flight cache between tests. */
export function _resetInFlight(): void {
  inFlight.clear();
}

export type SyncSpaceMembersThunk = (
  dispatch: AppDispatch,
  getState: () => RootState,
) => Promise<void>;

/**
 * Fetch authoritative member list from backend and atomically update Redux + IDB.
 * Safe to call concurrently — second caller awaits the first's promise.
 *
 * Returns 404 → no-op (caller is responsible for triggering cleanupSpaceState if needed;
 * we don't import that here to avoid the circular hook dependency). Other errors → swallowed,
 * existing state preserved.
 */
export function syncSpaceMembers(spaceId: string) {
  return (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    // Relay-authoritative (nip29-native) spaces have NO backend membership —
    // their roster comes from kind:39002 (applied by the pipeline). A backend
    // fetch would 404 / "not a member", so skip it at the single source of truth
    // (protects every caller: useMemberRoles, useSpace, loginFlow, 39002 nudges).
    const space = getState().spaces.list.find((s) => s.id === spaceId);
    if (space && !isBackendBacked(space)) return Promise.resolve();

    const existing = inFlight.get(spaceId);
    if (existing) return existing;

    const p = (async () => {
      try {
        const members = await fetchAllMemberRoles(spaceId);

        // Empty list is treated as "no info" — never overwrite a populated state with [].
        // Matches the legacy `useSpace.syncMembers` behavior at line 121 of the old code.
        if (members.length === 0) return;

        const pubkeys = members.map((m) => m.pubkey);

        const named = pubkeys.filter((pk) => profileCache.getCached(pk) != null).length;
        log.info(
          `members synced for ${spaceId.slice(0, 8)}…: ${members.length} members, ${named}/${members.length} have a cached name (rest will render a hash until their kind:0 loads)`,
        );

        dispatch(setMembers({ spaceId, members }));
        dispatch(updateSpaceMembers({ spaceId, members: pubkeys }));

        // Write-through to IDB. Best-effort: persistence failure must not fail the dispatch.
        saveMembers(spaceId, members).catch((err) => {
          console.warn("[syncSpaceMembers] IDB persist failed:", err);
        });
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 404) {
          // Space gone on backend. Caller (useSpace) handles cleanup via its own 404 path
          // when it calls this thunk; we re-throw so the caller can detect.
          throw err;
        }
        // Network / 401 / other: keep current state.
        console.warn("[syncSpaceMembers] fetch failed:", err);
      } finally {
        inFlight.delete(spaceId);
      }
    })();

    inFlight.set(spaceId, p);
    return p;
  };
}

/** Per-spaceId debounced refresh trigger (e.g. for kind:39002 nudges). */
const pendingNudge = new Map<string, ReturnType<typeof setTimeout>>();
const NUDGE_DEBOUNCE_MS = 500;

/**
 * Debounced wrapper. Coalesces bursts (relay re-emits 39002 on every membership change).
 * Caller must pass `dispatch` so this can run outside React.
 */
export function scheduleMemberSync(
  spaceId: string,
  dispatch: AppDispatch,
): void {
  const existing = pendingNudge.get(spaceId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingNudge.delete(spaceId);
    void dispatch(syncSpaceMembers(spaceId));
  }, NUDGE_DEBOUNCE_MS);

  pendingNudge.set(spaceId, timer);
}

/** Test-only: clear pending nudges. */
export function _resetPendingNudges(): void {
  for (const t of pendingNudge.values()) clearTimeout(t);
  pendingNudge.clear();
}
