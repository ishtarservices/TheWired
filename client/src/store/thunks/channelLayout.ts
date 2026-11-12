/**
 * Channel layout writes for every space mode (docs/CHANNEL_LAYOUT.md).
 *
 * - Platform / A-lite spaces: the backend owns the layout. Structural edits go
 *   through one versioned document (`PUT /channels/layout`); channel create /
 *   edit / delete stay on their REST routes, followed by a layout refetch so
 *   the revision, categories and canonical positions stay in step.
 * - Relay-only (NIP-29-native) spaces: the layout IS a kind:30078 event the
 *   admins sign; channels live in it, so every edit republishes it.
 *
 * Every write is applied optimistically and rolled back on failure, and writes
 * are serialized per space so rapid drags don't race each other's revision.
 * A stale (409) structural edit is re-applied once to the fresh layout — the
 * operations are id-based `tree -> tree` functions, so that's always sound.
 */
import { nanoid } from "nanoid";
import type { AppDispatch, RootState } from "../index";
import type { SpaceChannel, SpaceChannelCategory, SpaceChannelType, ChannelFeedMode } from "../../types/space";
import { setChannelLayout, setChannels, setLayoutSupported } from "../slices/spacesSlice";
import * as channelsApi from "../../lib/api/channels";
import { ApiRequestError } from "../../lib/api/client";
import { saveChannels, saveCategories } from "../../lib/db/channelStore";
import { signAndPublish } from "../../lib/nostr/publish";
import {
  buildChannelTree,
  treeToState,
  treeToLayoutDoc,
  addCategory,
  addChannel,
  removeChannel,
  moveChannel,
  updateChannel as updateChannelOp,
  deriveCategoryId,
  flattenTree,
  TreeOpError,
  type TreeOp,
} from "../../features/spaces/channelTree";
import { isNip29Native } from "../../features/spaces/spaceType";
import {
  buildLayoutEvent,
  nextLayoutCreatedAt,
  authorizedLayoutAuthors,
  NATIVE_DEFAULT_CHAT_ID,
} from "../../features/spaces/channelLayout";
import { newestLayoutCreatedAt, isNativeLayoutLoaded } from "../../features/spaces/nip29SpaceSync";

type Thunk<T> = (dispatch: AppDispatch, getState: () => RootState) => Promise<T>;

/** Fill fields older rows / caches may lack. */
export function normalizeChannelRows(channels: SpaceChannel[]): SpaceChannel[] {
  return channels.map((c) => (c.feedMode ? c : { ...c, feedMode: "all" as const }));
}

/**
 * Put a layout into Redux + IndexedDB. Without `categories` (a channels-only
 * source: cache, preview, older backend) the current categories are kept and
 * the sidebar groups by whatever it knows.
 */
export function hydrateChannelLayout(payload: {
  spaceId: string;
  channels: SpaceChannel[];
  categories?: SpaceChannelCategory[];
  revision?: number;
}) {
  return (dispatch: AppDispatch): void => {
    const { spaceId, categories, revision } = payload;
    const channels = normalizeChannelRows(payload.channels);
    if (categories) {
      dispatch(setChannelLayout({ spaceId, channels, categories, revision }));
      void saveCategories(spaceId, { categories, revision }).catch(() => {});
    } else {
      dispatch(setChannels({ spaceId, channels }));
    }
    void saveChannels(spaceId, channels).catch(() => {});
  };
}

/**
 * Fetch a backend-backed space's layout. A 404 from a backend that predates
 * subfolders (no such route) falls back to the flat channel list and marks
 * management unsupported — the sidebar still groups by the legacy strings.
 * The route's own 404 (`NOT_FOUND`: the space isn't on the backend yet, e.g.
 * mid-creation) also falls back but decides nothing about support.
 */
export function loadChannelLayout(spaceId: string): Thunk<channelsApi.ChannelLayoutResponse | null> {
  return async (dispatch) => {
    try {
      const layout = await channelsApi.fetchLayout(spaceId);
      dispatch(setLayoutSupported({ spaceId, supported: true }));
      dispatch(hydrateChannelLayout({ spaceId, ...layout }));
      return layout;
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) {
        if (err.code !== "NOT_FOUND") dispatch(setLayoutSupported({ spaceId, supported: false }));
        const channels = await channelsApi.fetchChannels(spaceId);
        dispatch(hydrateChannelLayout({ spaceId, channels }));
        return null;
      }
      throw err;
    }
  };
}

// ── Per-space write queue ────────────────────────────────────────────────

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(spaceId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(spaceId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  queues.set(spaceId, tail);
  void tail.then(() => {
    if (queues.get(spaceId) === tail) queues.delete(spaceId);
  });
  return run;
}

function snapshot(state: RootState, spaceId: string) {
  return {
    channels: state.spaces.channels[spaceId] ?? [],
    categories: state.spaces.categories[spaceId],
    revision: state.spaces.layoutRevision[spaceId],
  };
}

function rollback(dispatch: AppDispatch, spaceId: string, prev: ReturnType<typeof snapshot>): void {
  if (prev.categories) {
    dispatch(setChannelLayout({ spaceId, channels: prev.channels, categories: prev.categories }));
  } else {
    dispatch(setChannels({ spaceId, channels: prev.channels }));
  }
}

const isStale = (err: unknown) => err instanceof ApiRequestError && err.status === 409;

// ── Relay-only spaces ────────────────────────────────────────────────────

async function publishNativeOp(
  dispatch: AppDispatch,
  getState: () => RootState,
  spaceId: string,
  op: TreeOp,
): Promise<void> {
  const state = getState();
  const space = state.spaces.list.find((s) => s.id === spaceId);
  const me = state.identity.pubkey;
  if (!space || !me) throw new TreeOpError("Sign in to change this space.");
  if (!authorizedLayoutAuthors(space).includes(me)) {
    throw new TreeOpError("Only this space's admins can change its channels.");
  }
  // Publishing replaces the whole layout: never before this client has seen
  // the one on the relay (a fresh device or a stale cache would overwrite it).
  if (!isNativeLayoutLoaded(spaceId)) {
    throw new TreeOpError("This space's channels are still loading from its relay. Try again in a moment.");
  }

  const prev = snapshot(state, spaceId);
  const next = treeToState(op(buildChannelTree(prev.channels, prev.categories)));
  const defaultChannel =
    next.channels.find((c) => c.isDefault) ?? next.channels.find((c) => c.id === NATIVE_DEFAULT_CHAT_ID);
  if (!defaultChannel) throw new TreeOpError("The space's main chat can't be removed.");

  dispatch(setChannelLayout({ spaceId, ...next }));
  try {
    const createdAt = nextLayoutCreatedAt(newestLayoutCreatedAt(spaceId));
    // h-tagged: routed to the space's relays, and the pipeline applies it
    // locally (so the candidate picker sees it at once).
    await signAndPublish(buildLayoutEvent(me, space.id, { ...next, defaultChannelId: defaultChannel.id }, createdAt));
    void saveChannels(spaceId, next.channels).catch(() => {});
    void saveCategories(spaceId, { categories: next.categories }).catch(() => {});
  } catch (err) {
    rollback(dispatch, spaceId, prev);
    throw err;
  }
}

// ── Structural edits (categories, moves) ─────────────────────────────────

/** Apply a tree operation to a space's layout (optimistic, serialized, retried once on 409). */
export function applyChannelLayoutOp(spaceId: string, op: TreeOp): Thunk<void> {
  return (dispatch, getState) =>
    enqueue(spaceId, async () => {
      const space = getState().spaces.list.find((s) => s.id === spaceId);
      if (!space) throw new TreeOpError("This space is gone.");
      if (isNip29Native(space)) return publishNativeOp(dispatch, getState, spaceId, op);

      let s = getState().spaces;
      if (s.layoutSupported[spaceId] !== true || s.layoutRevision[spaceId] === undefined || !s.categories[spaceId]) {
        await dispatch(loadChannelLayout(spaceId));
        s = getState().spaces;
      }
      if (s.layoutSupported[spaceId] === false) {
        throw new TreeOpError("This space's server doesn't support subfolders yet.");
      }

      const attempt = async () => {
        const prev = snapshot(getState(), spaceId);
        const next = op(buildChannelTree(prev.channels, prev.categories));
        dispatch(setChannelLayout({ spaceId, ...treeToState(next) }));
        try {
          const saved = await channelsApi.putLayout(spaceId, treeToLayoutDoc(next, prev.revision ?? 0));
          dispatch(hydrateChannelLayout({ spaceId, ...saved }));
        } catch (err) {
          rollback(dispatch, spaceId, prev);
          throw err;
        }
      };
      try {
        await attempt();
      } catch (err) {
        if (!isStale(err)) throw err;
        // Someone else changed the layout: re-apply this edit to theirs.
        await dispatch(loadChannelLayout(spaceId));
        await attempt();
      }
    });
}

/**
 * Create a subfolder and resolve to its id (REST assigns it on save; relay-only
 * spaces derive it locally with the same rule).
 */
export function createChannelCategory(spaceId: string, name: string): Thunk<string> {
  return async (dispatch, getState) => {
    const space = getState().spaces.list.find((s) => s.id === spaceId);
    const trimmed = name.trim();
    if (space && isNip29Native(space)) {
      const taken = new Set((getState().spaces.categories[spaceId] ?? []).map((c) => c.id));
      for (const ch of getState().spaces.channels[spaceId] ?? []) if (ch.categoryId) taken.add(ch.categoryId);
      const id = deriveCategoryId(trimmed, taken, () => nanoid(12));
      await dispatch(applyChannelLayoutOp(spaceId, addCategory(trimmed, id, spaceId, false)));
      return id;
    }
    await dispatch(applyChannelLayoutOp(spaceId, addCategory(trimmed, `pending:${nanoid(8)}`, spaceId, true)));
    const created = (getState().spaces.categories[spaceId] ?? []).find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (!created) throw new TreeOpError("The subfolder wasn't saved.");
    return created.id;
  };
}

// ── Channel create / edit / delete ───────────────────────────────────────

export interface NewChannelParams {
  type: SpaceChannelType;
  label: string;
  categoryId: string | null;
  adminOnly?: boolean;
  slowModeSeconds?: number;
  temporary?: boolean;
  feedMode?: ChannelFeedMode;
}

export function createSpaceChannel(spaceId: string, params: NewChannelParams): Thunk<SpaceChannel> {
  return async (dispatch, getState) => {
    const space = getState().spaces.list.find((s) => s.id === spaceId);
    if (space && isNip29Native(space)) {
      // Relay-only: the channel is just an entry in the layout.
      const channel: SpaceChannel = {
        id: nanoid(12),
        spaceId,
        type: params.type,
        label: params.label,
        categoryId: params.categoryId,
        position: 0,
        isDefault: false,
        adminOnly: false,
        slowModeSeconds: 0,
        feedMode: params.feedMode ?? "all",
      };
      await dispatch(applyChannelLayoutOp(spaceId, addChannel(channel, params.categoryId)));
      return channel;
    }
    return enqueue(spaceId, async () => {
      const created = await channelsApi.createChannel(spaceId, params);
      await refreshAfterWrite(dispatch, getState, spaceId, created);
      return created;
    });
  };
}

export interface ChannelPatch {
  label?: string;
  categoryId?: string | null;
  adminOnly?: boolean;
  slowModeSeconds?: number;
  isDefault?: boolean;
  feedMode?: ChannelFeedMode;
}

export function updateSpaceChannel(spaceId: string, channelId: string, patch: ChannelPatch): Thunk<void> {
  return async (dispatch, getState) => {
    const space = getState().spaces.list.find((s) => s.id === spaceId);
    if (space && isNip29Native(space)) {
      const { label, feedMode, categoryId } = patch;
      await dispatch(
        applyChannelLayoutOp(spaceId, (tree) => {
          let next = tree;
          if (label !== undefined || feedMode !== undefined) {
            next = updateChannelOp(channelId, {
              ...(label !== undefined ? { label } : {}),
              ...(feedMode !== undefined ? { feedMode } : {}),
            })(next);
          }
          const current = flattenTree(next).find((c) => c.id === channelId);
          if (categoryId !== undefined && current && (current.categoryId ?? null) !== categoryId) {
            next = moveChannel(channelId, categoryId, Number.POSITIVE_INFINITY)(next);
          }
          return next;
        }),
      );
      return;
    }
    await enqueue(spaceId, async () => {
      const updated = await channelsApi.updateChannel(spaceId, channelId, patch);
      await refreshAfterWrite(dispatch, getState, spaceId, updated);
    });
  };
}

export function deleteSpaceChannel(spaceId: string, channelId: string): Thunk<void> {
  return async (dispatch, getState) => {
    const space = getState().spaces.list.find((s) => s.id === spaceId);
    if (space && isNip29Native(space)) {
      const channel = (getState().spaces.channels[spaceId] ?? []).find((c) => c.id === channelId);
      if (channel?.isDefault || channelId === NATIVE_DEFAULT_CHAT_ID) {
        throw new TreeOpError("The space's main chat can't be deleted.");
      }
      await dispatch(applyChannelLayoutOp(spaceId, removeChannel(channelId)));
      return;
    }
    await enqueue(spaceId, async () => {
      await channelsApi.deleteChannel(spaceId, channelId);
      await refreshAfterWrite(dispatch, getState, spaceId, undefined, channelId);
    });
  };
}

/** Make a channel follow its subfolder's permissions again. */
export function syncChannelPermissions(spaceId: string, channelId: string): Thunk<void> {
  return async (dispatch, getState) => {
    await enqueue(spaceId, async () => {
      const updated = await channelsApi.syncChannelPermissions(spaceId, channelId);
      await refreshAfterWrite(dispatch, getState, spaceId, updated);
    });
  };
}

/**
 * After a REST channel write: refetch the layout (revision, canonical
 * positions, categories a legacy write may have created). If that fails, at
 * least splice the returned row in so the UI reflects the write.
 */
async function refreshAfterWrite(
  dispatch: AppDispatch,
  getState: () => RootState,
  spaceId: string,
  written?: SpaceChannel,
  removedId?: string,
): Promise<void> {
  try {
    await dispatch(loadChannelLayout(spaceId));
  } catch {
    const current = getState().spaces.channels[spaceId] ?? [];
    let channels = removedId ? current.filter((c) => c.id !== removedId) : current;
    if (written) {
      channels = channels.some((c) => c.id === written.id)
        ? channels.map((c) => (c.id === written.id ? written : c))
        : [...channels, written];
    }
    dispatch(setChannels({ spaceId, channels: normalizeChannelRows(channels) }));
  }
}
