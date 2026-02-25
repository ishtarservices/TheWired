import { useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { updateMemberRoles } from "../../store/slices/spaceConfigSlice";
import type { SpaceRole } from "../../types/space";
import * as rolesApi from "../../lib/api/roles";

export function useMemberRoles(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const members = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.members[spaceId] : undefined) ?? [],
  );

  const handleAssignRole = useCallback(
    async (pubkey: string, roleId: string) => {
      if (!spaceId) return;
      await rolesApi.assignRole(spaceId, pubkey, roleId);
      // Refetch member roles
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
  };
}
