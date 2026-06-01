import { useEffect, useCallback, useRef } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setMyPermissions, setMyChannelOverrides } from "../../store/slices/spaceConfigSlice";
import * as rolesApi from "../../lib/api/roles";
import { isNip29Native } from "./spaceType";
import { nip29MyPermissions } from "./synthesizeNip29Roles";

const EMPTY_PERMS: string[] = [];
const EMPTY_OVERRIDES: Record<string, { allow: string[]; deny: string[] }> = {};

export function usePermissions(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const permissions = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.myPermissions[spaceId] : undefined) ?? EMPTY_PERMS,
  );
  const channelOverrides = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.myChannelOverrides[spaceId] : undefined) ?? EMPTY_OVERRIDES,
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaceConfig.loading[spaceId] : false) ?? false,
  );
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const space = useAppSelector((s) =>
    spaceId ? s.spaces.list.find((x) => x.id === spaceId) : undefined,
  );
  const native = space ? isNip29Native(space) : false;
  const adminPubkeys = space?.adminPubkeys;

  // Track which spaceId we last fetched for to avoid redundant requests
  // but still refetch when switching spaces
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;
    // NIP-29-native: derive coarse permissions from the relay admin set (39001)
    // rather than the backend (which has no record of this space).
    if (native) {
      dispatch(
        setMyPermissions({ spaceId, permissions: nip29MyPermissions(myPubkey, adminPubkeys ?? []) }),
      );
      lastFetchedRef.current = spaceId;
      return;
    }
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
  }, [spaceId, dispatch, native, myPubkey, adminPubkeys]);

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
