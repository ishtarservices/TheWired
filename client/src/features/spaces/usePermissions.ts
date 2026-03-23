import { useEffect, useCallback, useRef } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setMyPermissions, setMyChannelOverrides } from "../../store/slices/spaceConfigSlice";
import * as rolesApi from "../../lib/api/roles";

export function usePermissions(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const permissions = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.myPermissions[spaceId] : undefined) ?? [],
  );
  const channelOverrides = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.myChannelOverrides[spaceId] : undefined) ?? {},
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.loading[spaceId] : false) ?? false,
  );

  // Track which spaceId we last fetched for to avoid redundant requests
  // but still refetch when switching spaces
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    if (lastFetchedRef.current === spaceId) return;

    let cancelled = false;

    (async () => {
      try {
        // Fetch batch endpoint: space permissions + channel overrides in one call
        const result = await rolesApi.fetchMyChannelPermissions(spaceId);
        if (!cancelled) {
          dispatch(setMyPermissions({ spaceId, permissions: result.spacePermissions }));
          dispatch(setMyChannelOverrides({ spaceId, overrides: result.channelOverrides }));
          lastFetchedRef.current = spaceId;
        }
      } catch {
        // Fallback: try the simple endpoint if batch isn't available
        try {
          const perms = await rolesApi.fetchMyPermissions(spaceId);
          if (!cancelled) {
            dispatch(setMyPermissions({ spaceId, permissions: perms }));
            lastFetchedRef.current = spaceId;
          }
        } catch {
          // Not authenticated or backend unavailable — permissions stay empty
          if (!cancelled) {
            lastFetchedRef.current = spaceId;
          }
        }
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch]);

  const isAdmin = permissions.includes("MANAGE_SPACE") || permissions.includes("MANAGE_ROLES");

  const can = useCallback(
    (permission: string, channelId?: string): boolean => {
      if (isAdmin) return true;

      if (!channelId) {
        return permissions.includes(permission);
      }

      // Channel-level check with deny-wins model
      const ov = channelOverrides[channelId];
      if (ov?.deny.includes(permission)) return false;   // deny wins, period
      if (ov?.allow.includes(permission)) return true;    // explicit allow
      return permissions.includes(permission);             // inherit from space
    },
    [permissions, isAdmin, channelOverrides],
  );

  const refresh = useCallback(async () => {
    if (!spaceId) return;
    try {
      const result = await rolesApi.fetchMyChannelPermissions(spaceId);
      dispatch(setMyPermissions({ spaceId, permissions: result.spacePermissions }));
      dispatch(setMyChannelOverrides({ spaceId, overrides: result.channelOverrides }));
    } catch {
      try {
        const perms = await rolesApi.fetchMyPermissions(spaceId);
        dispatch(setMyPermissions({ spaceId, permissions: perms }));
      } catch {
        // silent
      }
    }
  }, [spaceId, dispatch]);

  return {
    can,
    isAdmin,
    permissions,
    channelOverrides,
    isLoading,
    refresh,
  };
}
