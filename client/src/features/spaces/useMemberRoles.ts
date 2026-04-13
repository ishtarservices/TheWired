import { useCallback, useEffect } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setMembers, updateMemberRoles } from "../../store/slices/spaceConfigSlice";
import type { SpaceRole } from "../../types/space";
import * as rolesApi from "../../lib/api/roles";

/** Track which spaces have been bulk-fetched to avoid redundant requests across hook instances */
const fetchedSpaces = new Set<string>();
const EMPTY_MEMBERS: never[] = [];

export function useMemberRoles(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const members = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.members[spaceId] : undefined) ?? EMPTY_MEMBERS,
  );

  // Auto-fetch all members with roles on first mount per space
  useEffect(() => {
    if (!spaceId || fetchedSpaces.has(spaceId)) return;
    fetchedSpaces.add(spaceId); // Mark immediately to deduplicate concurrent mounts
    rolesApi.fetchAllMemberRoles(spaceId)
      .then((data) => {
        dispatch(setMembers({ spaceId, members: data }));
      })
      .catch((err) => {
        fetchedSpaces.delete(spaceId); // Allow retry on error
        console.error("[useMemberRoles] Failed to fetch member roles:", err);
      });
  }, [spaceId, dispatch]);

  const refetchAll = useCallback(
    async () => {
      if (!spaceId) return;
      const data = await rolesApi.fetchAllMemberRoles(spaceId);
      dispatch(setMembers({ spaceId, members: data }));
    },
    [spaceId, dispatch],
  );

  const handleAssignRole = useCallback(
    async (pubkey: string, roleId: string) => {
      if (!spaceId) return;
      await rolesApi.assignRole(spaceId, pubkey, roleId);
      const roles = await rolesApi.fetchMemberRoles(spaceId, pubkey);
      dispatch(updateMemberRoles({ spaceId, pubkey, roles: roles as SpaceRole[] }));
    },
    [spaceId, dispatch],
  );

  const handleRemoveRole = useCallback(
    async (pubkey: string, roleId: string) => {
      if (!spaceId) return;
      await rolesApi.removeRoleFromMember(spaceId, pubkey, roleId);
      const roles = await rolesApi.fetchMemberRoles(spaceId, pubkey);
      dispatch(updateMemberRoles({ spaceId, pubkey, roles: roles as SpaceRole[] }));
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
