import { useEffect, useCallback, useRef } from "react";
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

  // Track which spaceId we last fetched for to avoid redundant requests
  // but still refetch when switching spaces
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    if (lastFetchedRef.current === spaceId) return; // Already fetched for this space

    let cancelled = false;

    (async () => {
      try {
        const perms = await rolesApi.fetchMyPermissions(spaceId);
        if (!cancelled) {
          dispatch(setMyPermissions({ spaceId, permissions: perms }));
          lastFetchedRef.current = spaceId;
        }
      } catch {
        // Not authenticated or backend unavailable — permissions stay empty
        // which means can() returns false. This is safe: the user just
        // won't have advanced features but the app still works.
        if (!cancelled) {
          lastFetchedRef.current = spaceId;
        }
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch]);

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
