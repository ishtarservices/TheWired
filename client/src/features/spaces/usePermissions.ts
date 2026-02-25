import { useEffect, useCallback } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setMyPermissions } from "../../store/slices/spaceConfigSlice";
import * as rolesApi from "../../lib/api/roles";

export function usePermissions(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const permissions = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.myPermissions[spaceId] : undefined) ?? [],
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.loading[spaceId] : false) ?? false,
  );

  useEffect(() => {
    if (!spaceId) return;
    if (permissions.length > 0) return; // Already loaded

    let cancelled = false;

    (async () => {
      try {
        const perms = await rolesApi.fetchMyPermissions(spaceId);
        if (!cancelled) {
          dispatch(setMyPermissions({ spaceId, permissions: perms }));
        }
      } catch {
        // Not authenticated or backend unavailable
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch, permissions.length]);

  const isAdmin = permissions.includes("MANAGE_SPACE") || permissions.includes("MANAGE_ROLES");

  const can = useCallback(
    (permission: string, _channelId?: string): boolean => {
      if (isAdmin) return true;
      return permissions.includes(permission);
    },
    [permissions, isAdmin],
  );

  const refresh = useCallback(async () => {
    if (!spaceId) return;
    try {
      const perms = await rolesApi.fetchMyPermissions(spaceId);
      dispatch(setMyPermissions({ spaceId, permissions: perms }));
    } catch {
      // silent
    }
  }, [spaceId, dispatch]);

  return {
    can,
    isAdmin,
    permissions,
    isLoading,
    refresh,
  };
}
