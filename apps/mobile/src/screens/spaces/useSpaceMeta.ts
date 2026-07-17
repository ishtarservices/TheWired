// ─── Space-meta hooks ─────────────────────────────────────────────────
// Screen side of the space-meta cache: hydrate-before-network on mount for
// instant paint, a focus-effect refresh the 60s staleness gate makes ~free,
// and refresh() (force) for pull-to-refresh / Try again. useMySpaces mirrors
// it for the joined list — App.tsx owns its one-time hydrate.

import { useCallback, useEffect } from "react";
import { useFocusEffect } from "@react-navigation/native";

import type { MySpace, SpaceChannel, SpaceDetail } from "@/lib/api/spaces";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectMySpaces,
  selectMySpacesStatus,
  selectSpaceMeta,
  type SpaceMetaStatus,
} from "@/store/slices/spaceMetaSlice";
import { hydrateSpaceMeta, loadMySpaces, loadSpaceMeta } from "@/store/spaceMeta";

const EMPTY_PUBKEYS: string[] = [];

export interface SpaceMeta {
  detail: SpaceDetail | null;
  channels: SpaceChannel[] | null;
  /** Display-only roster prefix — see SpaceMetaEntry.memberPubkeys. */
  memberPubkeys: string[];
  status: SpaceMetaStatus;
  error: string | null;
  /** Force refresh (pull-to-refresh, Try again). */
  refresh: () => void;
}

export function useSpaceMeta(spaceId: string): SpaceMeta {
  const dispatch = useAppDispatch();
  const entry = useAppSelector((s) => selectSpaceMeta(s, spaceId));

  // Hydrate-before-network; the load deliberately races the SQLite read
  // (the slice merges hydrated data only while it's still emptier).
  useEffect(() => {
    void dispatch(hydrateSpaceMeta(spaceId)).then(() => {
      void dispatch(loadSpaceMeta(spaceId));
    });
  }, [dispatch, spaceId]);

  // Focus revisits refresh silently — the staleness gate makes this ~free.
  useFocusEffect(
    useCallback(() => {
      void dispatch(loadSpaceMeta(spaceId));
    }, [dispatch, spaceId]),
  );

  const refresh = useCallback(() => {
    void dispatch(loadSpaceMeta(spaceId, { force: true }));
  }, [dispatch, spaceId]);

  return {
    detail: entry?.detail ?? null,
    channels: entry?.channels ?? null,
    memberPubkeys: entry?.memberPubkeys ?? EMPTY_PUBKEYS,
    status: entry?.status ?? "idle",
    error: entry?.error ?? null,
    refresh,
  };
}

export interface MySpacesResult {
  /** null until the first load/hydrate answers (guests resolve to []). */
  spaces: MySpace[] | null;
  status: SpaceMetaStatus;
  refresh: () => void;
}

export function useMySpaces(): MySpacesResult {
  const dispatch = useAppDispatch();
  const spaces = useAppSelector(selectMySpaces);
  const status = useAppSelector(selectMySpacesStatus);

  // No hydrate here — App.tsx hydrates once per identity; this keeps the
  // list fresh whenever a consumer screen regains focus (stale-gated).
  useFocusEffect(
    useCallback(() => {
      void dispatch(loadMySpaces());
    }, [dispatch]),
  );

  const refresh = useCallback(() => {
    void dispatch(loadMySpaces({ force: true }));
  }, [dispatch]);

  return { spaces, status, refresh };
}
