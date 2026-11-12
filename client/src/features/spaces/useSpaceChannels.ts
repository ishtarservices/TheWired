import { useEffect, useCallback, useRef, useMemo } from "react";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setChannels, setChannelsLoading } from "../../store/slices/spacesSlice";
import type { Space, SpaceChannel, SpaceChannelCategory, SpaceChannelType } from "../../types/space";
import { isNip29Native } from "./spaceType";
import { loadChannels, loadCategories } from "../../lib/db/channelStore";
import { buildChannelTree, type TreeOp } from "./channelTree";
import { defaultNativeChannels } from "./channelLayout";
import {
  hydrateChannelLayout,
  loadChannelLayout,
  applyChannelLayoutOp,
  createChannelCategory,
  createSpaceChannel,
  updateSpaceChannel,
  deleteSpaceChannel,
  type NewChannelParams,
  type ChannelPatch,
} from "../../store/thunks/channelLayout";

const EMPTY_CHANNELS: SpaceChannel[] = [];

/** Hardcoded defaults used when backend is unavailable */
function makeDefaultChannels(spaceId: string, mode: Space["mode"]): SpaceChannel[] {
  const types: Array<{ type: SpaceChannelType; label: string }> = [
    { type: "chat", label: "#chat" },
    { type: "notes", label: "#notes" },
    { type: "media", label: "#media" },
    { type: "articles", label: "#articles" },
    { type: "music", label: "#music" },
  ];
  // Read-only spaces don't have chat
  const filtered = mode === "read" ? types.filter((t) => t.type !== "chat") : types;
  return filtered.map((ch, i) => ({
    id: `default-${ch.type}`,
    spaceId,
    type: ch.type,
    label: ch.label,
    position: i,
    isDefault: i === 0,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all" as const,
  }));
}

const EMPTY_CATEGORIES: SpaceChannelCategory[] | undefined = undefined;

/**
 * A space's channels + subfolders, loaded for every space mode, plus the
 * mode-aware write actions (REST for backend-backed spaces, a signed layout
 * event for relay-only ones). See store/thunks/channelLayout.ts.
 */
export function useSpaceChannels(spaceId: string | null) {
  const dispatch = useAppDispatch();
  const channels = useAppSelector(
    (s) => (spaceId ? s.spaces.channels[spaceId] : undefined) ?? EMPTY_CHANNELS,
  );
  const categories = useAppSelector(
    (s) => (spaceId ? s.spaces.categories[spaceId] : undefined) ?? EMPTY_CATEGORIES,
  );
  const isLoading = useAppSelector(
    (s) => (spaceId ? s.spaces.channelsLoading[spaceId] : false) ?? false,
  );
  const spaceMode = useAppSelector(
    (s) => s.spaces.list.find((sp) => sp.id === spaceId)?.mode ?? "read-write",
  );
  const native = useAppSelector((s) => {
    const sp = spaceId ? s.spaces.list.find((x) => x.id === spaceId) : undefined;
    return sp ? isNip29Native(sp) : false;
  });
  const backendLayoutSupported = useAppSelector(
    (s) => (spaceId ? s.spaces.layoutSupported[spaceId] : undefined),
  );

  // Track the last spaceId we fetched from backend to avoid redundant calls
  // within the same space selection (but allow refetch when switching back)
  const lastFetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!spaceId) return;

    // NIP-29-native spaces have no backend channels — synthesize a chat channel
    // until the space's kind:30078 layout arrives (nip29SpaceSync applies it).
    if (native) {
      if (channels.length === 0) {
        dispatch(setChannels({ spaceId, channels: defaultNativeChannels(spaceId) }));
      }
      dispatch(setChannelsLoading({ spaceId, loading: false }));
      return;
    }

    let cancelled = false;
    const hasCached = channels.length > 0;
    const needsBackendFetch = lastFetchedRef.current !== spaceId;

    // Show loading only on first load (no cached data)
    if (!hasCached) {
      dispatch(setChannelsLoading({ spaceId, loading: true }));
    }

    (async () => {
      // Serve cached data immediately (from Redux or IndexedDB)
      if (!hasCached) {
        const [cached, cachedCategories] = await Promise.all([
          loadChannels(spaceId).catch(() => undefined),
          loadCategories(spaceId).catch(() => undefined),
        ]);
        if (cached && cached.length > 0 && !cancelled) {
          dispatch(
            hydrateChannelLayout({
              spaceId,
              channels: cached,
              categories: cachedCategories?.categories,
              revision: cachedCategories?.revision,
            }),
          );
        }
      }

      // Always revalidate from backend when entering a space
      if (needsBackendFetch) {
        try {
          await dispatch(loadChannelLayout(spaceId));
          if (!cancelled) lastFetchedRef.current = spaceId;
        } catch {
          // Backend unavailable — fall back to defaults if nothing cached
          if (!cancelled && !hasCached) {
            const cached = await loadChannels(spaceId).catch(() => undefined);
            if (!cached || cached.length === 0) {
              dispatch(setChannels({ spaceId, channels: makeDefaultChannels(spaceId, spaceMode) }));
            }
          }
        }
      }

      if (!cancelled) {
        dispatch(setChannelsLoading({ spaceId, loading: false }));
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, dispatch, native]); // eslint-disable-line react-hooks/exhaustive-deps
  // Note: channels.length intentionally excluded to avoid infinite loops

  const tree = useMemo(() => buildChannelTree(channels, categories), [channels, categories]);

  const createChannel = useCallback(
    async (params: NewChannelParams) => {
      if (!spaceId) throw new Error("No space");
      return dispatch(createSpaceChannel(spaceId, params));
    },
    [spaceId, dispatch],
  );

  const deleteChannel = useCallback(
    async (channelId: string) => {
      if (!spaceId) return;
      await dispatch(deleteSpaceChannel(spaceId, channelId));
    },
    [spaceId, dispatch],
  );

  const updateChannel = useCallback(
    async (channelId: string, patch: ChannelPatch) => {
      if (!spaceId) return;
      await dispatch(updateSpaceChannel(spaceId, channelId, patch));
    },
    [spaceId, dispatch],
  );

  /** Apply a structural edit (move, reorder, rename/delete subfolder). */
  const applyOp = useCallback(
    async (op: TreeOp) => {
      if (!spaceId) return;
      await dispatch(applyChannelLayoutOp(spaceId, op));
    },
    [spaceId, dispatch],
  );

  const createCategory = useCallback(
    async (name: string) => {
      if (!spaceId) throw new Error("No space");
      return dispatch(createChannelCategory(spaceId, name));
    },
    [spaceId, dispatch],
  );

  return {
    channels,
    categories,
    tree,
    isLoading,
    native,
    /** Subfolders can be managed (backend supports it, or a relay-only space). */
    layoutManageable: native || backendLayoutSupported === true,
    createChannel,
    deleteChannel,
    updateChannel,
    applyOp,
    createCategory,
  };
}
