import { useEffect, useCallback, useRef } from "react";
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
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    // Already fetched for this space and got results — skip
    if (fetchedRef.current === spaceId && roles.length > 0) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    async function fetchRoles(attempt: number) {
      try {
        const fetched = await rolesApi.fetchRoles(spaceId!);
        if (cancelled) return;
        fetchedRef.current = spaceId;
        dispatch(setRoles({ spaceId: spaceId!, roles: fetched as SpaceRole[] }));

        // If backend returned empty (roles not seeded yet), retry up to 3 times
        if (fetched.length === 0 && attempt < 3) {
          retryTimer = setTimeout(() => {
            if (!cancelled) fetchRoles(attempt + 1);
          }, 1000 * attempt); // 1s, 2s, 3s backoff
        }
      } catch {
        // Backend unavailable — retry once after delay
        if (!cancelled && attempt < 2) {
          retryTimer = setTimeout(() => {
            if (!cancelled) fetchRoles(attempt + 1);
          }, 2000);
        }
      }
    }

    fetchRoles(1);

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
    };
  }, [spaceId, dispatch]); // eslint-disable-line react-hooks/exhaustive-deps

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
