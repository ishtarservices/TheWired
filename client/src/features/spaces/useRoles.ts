import { useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import {
  setRoles,
  addRole,
  updateRoleInList,
  removeRole,
} from "../../store/slices/spaceConfigSlice";
import type { SpaceRole } from "../../types/space";
import * as rolesApi from "../../lib/api/roles";

export function useRoles(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const roles = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.roles[spaceId] : undefined) ?? [],
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.loading[spaceId] : false) ?? false,
  );

  useEffect(() => {
    if (!spaceId) return;
    if (roles.length > 0) return;

    let cancelled = false;

    (async () => {
      try {
        const fetched = await rolesApi.fetchRoles(spaceId);
        if (!cancelled) {
          dispatch(setRoles({ spaceId, roles: fetched as SpaceRole[] }));
        }
      } catch {
        // Backend unavailable
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch, roles.length]);

  const handleCreateRole = useCallback(
    async (params: { name: string; color?: string; permissions: string[]; isAdmin?: boolean }) => {
      if (!spaceId) return;
      const role = await rolesApi.createRole(spaceId, params);
      dispatch(addRole({ spaceId, role: role as SpaceRole }));
    },
    [spaceId, dispatch],
  );

  const handleUpdateRole = useCallback(
    async (roleId: string, params: { name?: string; color?: string; permissions?: string[] }) => {
      if (!spaceId) return;
      const role = await rolesApi.updateRole(spaceId, roleId, params);
      dispatch(updateRoleInList({ spaceId, role: role as SpaceRole }));
    },
    [spaceId, dispatch],
  );

  const handleDeleteRole = useCallback(
    async (roleId: string) => {
      if (!spaceId) return;
      await rolesApi.deleteRole(spaceId, roleId);
      dispatch(removeRole({ spaceId, roleId }));
    },
    [spaceId, dispatch],
  );

  const handleReorderRoles = useCallback(
    async (orderedIds: string[]) => {
      if (!spaceId) return;
      await rolesApi.reorderRoles(spaceId, orderedIds);
      const reordered = orderedIds
        .map((id, i) => {
          const r = roles.find((role) => role.id === id);
          return r ? { ...r, position: i } : null;
        })
        .filter((r): r is SpaceRole => r !== null);
      dispatch(setRoles({ spaceId, roles: reordered }));
    },
    [spaceId, dispatch, roles],
  );

  return {
    roles,
    isLoading,
    createRole: handleCreateRole,
    updateRole: handleUpdateRole,
    deleteRole: handleDeleteRole,
    reorderRoles: handleReorderRoles,
  };
}
