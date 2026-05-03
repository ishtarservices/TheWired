import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { syncSpaceMembers } from "../../store/thunks/spaceMembers";
import * as rolesApi from "../../lib/api/roles";

/**
 * Read-side hook for member-role data plus role-mutation helpers.
 *
 * Membership fetching is owned by the `syncSpaceMembers` thunk (called from
 * `useSpace.syncMembers` on space activation, from `loginFlow` on hydrate, and
 * debounced from `eventPipeline` on kind:39002 nudges). This hook no longer
 * triggers fetches on mount — the previous module-level cache `fetchedSpaces`
 * never refreshed during a session, which left admins bucketed as "Members"
 * after any role change. Single-source-of-truth lives in the thunk now.
 */

const EMPTY_MEMBERS: never[] = [];

export function useMemberRoles(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const members = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.members[spaceId] : undefined) ?? EMPTY_MEMBERS,
  );

  const refetchAll = useCallback(
    async () => {
      if (!spaceId) return;
      await dispatch(syncSpaceMembers(spaceId));
    },
    [spaceId, dispatch],
  );

  const handleAssignRole = useCallback(
    async (pubkey: string, roleId: string) => {
      if (!spaceId) return;
      await rolesApi.assignRole(spaceId, pubkey, roleId);
      // Refresh the whole roster (one fetch) so both slices stay consistent.
      await dispatch(syncSpaceMembers(spaceId));
    },
    [spaceId, dispatch],
  );

  const handleRemoveRole = useCallback(
    async (pubkey: string, roleId: string) => {
      if (!spaceId) return;
      await rolesApi.removeRoleFromMember(spaceId, pubkey, roleId);
      await dispatch(syncSpaceMembers(spaceId));
    },
    [spaceId, dispatch],
  );

  return {
    members,
    assignRole: handleAssignRole,
    removeRoleFromMember: handleRemoveRole,
    refetchAll,
  };
}
