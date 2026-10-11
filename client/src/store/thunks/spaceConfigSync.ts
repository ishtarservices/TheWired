/**
 * Space-config-changed nudges (WIR-196).
 *
 * The backend publishes a kind 20900 event, tagged `["d", spaceId]` plus one
 * `["what", …]` per changed area, after every admin write to a platform
 * space (services/backend/src/services/spaceSignalService.ts). It carries no
 * data: this module turns it into the matching REST refetch, so a rename,
 * a deleted channel, a role edit or a kick made on another device or on
 * mobile lands here without a reload. REST stays the authority — a forged
 * nudge can only cost one extra fetch, and bursts coalesce per space.
 */
import type { AppDispatch, RootState } from "../index";
import type { NostrEvent } from "../../types/nostr";
import { updateSpace, setChannels } from "../slices/spacesSlice";
import { setRoles, setBans, setMutes, setMyPermissions, setMyChannelOverrides } from "../slices/spaceConfigSlice";
import { addNotification } from "../slices/notificationSlice";
import { getSpace } from "../../lib/api/spaces";
import { fetchChannels } from "../../lib/api/channels";
import { fetchRoles, fetchMyChannelPermissions } from "../../lib/api/roles";
import { fetchBans, fetchMutes } from "../../lib/api/moderation";
import { updateSpaceInStore } from "../../lib/db/spaceStore";
import { saveChannels } from "../../lib/db/channelStore";
import { isBackendBacked } from "../../features/spaces/spaceType";
import { cleanupSpaceState } from "../../features/spaces/spaceCleanup";
import { syncSpaceMembers } from "./spaceMembers";
import type { SpaceRole, Ban, Mute } from "../../types/space";

export const SPACE_CHANGE_KINDS = ["meta", "channels", "roles", "members", "moderation", "deleted"] as const;
export type SpaceChange = (typeof SPACE_CHANGE_KINDS)[number];

/** `{ spaceId, changes }` from a nudge, or null when it isn't one we read. */
export function parseSpaceConfigChanged(event: NostrEvent): { spaceId: string; changes: SpaceChange[] } | null {
  const spaceId = event.tags.find((t) => t[0] === "d")?.[1];
  if (!spaceId) return null;
  const changes = event.tags
    .filter((t) => t[0] === "what")
    .map((t) => t[1])
    .filter((w): w is SpaceChange => (SPACE_CHANGE_KINDS as readonly string[]).includes(w));
  return changes.length > 0 ? { spaceId, changes } : null;
}

/** Refetch what a nudge named. Each area is independent: one failing fetch
 *  (no permission for bans, backend hiccup) never blocks the others. */
export function syncSpaceConfig(spaceId: string, changes: readonly SpaceChange[]) {
  return async (dispatch: AppDispatch, getState: () => RootState): Promise<void> => {
    const space = getState().spaces.list.find((s) => s.id === spaceId);
    if (!space || !isBackendBacked(space)) return;
    const wants = new Set(changes);

    if (wants.has("deleted")) {
      cleanupSpaceState(spaceId, dispatch);
      dispatch(
        addNotification({
          id: `space-gone-${spaceId}`,
          type: "chat",
          title: "Space removed",
          body: `${space.name} was deleted by its owner.`,
          timestamp: Math.floor(Date.now() / 1000),
        }),
      );
      return;
    }

    const jobs: Promise<unknown>[] = [];

    if (wants.has("meta")) {
      jobs.push(
        getSpace(spaceId).then((res) => {
          const current = getState().spaces.list.find((s) => s.id === spaceId);
          if (!current) return;
          const d = res.data;
          const updated = {
            ...current,
            name: d.name || current.name,
            about: d.about ?? undefined,
            picture: d.picture ?? undefined,
          };
          dispatch(updateSpace(updated));
          void updateSpaceInStore(updated).catch(() => {});
        }),
      );
    }

    if (wants.has("channels")) {
      jobs.push(
        fetchChannels(spaceId).then((channels) => {
          const normalized = channels.map((c) => (c.feedMode ? c : { ...c, feedMode: "all" as const }));
          dispatch(setChannels({ spaceId, channels: normalized }));
          void saveChannels(spaceId, normalized).catch(() => {});
        }),
      );
    }

    if (wants.has("roles")) {
      jobs.push(
        fetchRoles(spaceId).then((roles) => {
          if (roles.length > 0) dispatch(setRoles({ spaceId, roles: roles as SpaceRole[] }));
        }),
      );
    }

    if (wants.has("members")) {
      jobs.push(dispatch(syncSpaceMembers(spaceId)));
    }

    // My own standing may have moved with roles or member-roles.
    if (wants.has("roles") || wants.has("members")) {
      jobs.push(
        fetchMyChannelPermissions(spaceId).then((result) => {
          dispatch(setMyPermissions({ spaceId, permissions: result.spacePermissions }));
          dispatch(setMyChannelOverrides({ spaceId, overrides: result.channelOverrides }));
        }),
      );
    }

    if (wants.has("moderation") || wants.has("members")) {
      const perms = getState().spaceConfig.myPermissions[spaceId] ?? [];
      const mod = perms.includes("BAN_MEMBERS") || perms.includes("MUTE_MEMBERS") || perms.includes("MANAGE_SPACE");
      if (mod) {
        jobs.push(fetchBans(spaceId).then((bans) => dispatch(setBans({ spaceId, bans: bans as Ban[] }))));
        jobs.push(fetchMutes(spaceId).then((mutes) => dispatch(setMutes({ spaceId, mutes: mutes as Mute[] }))));
      }
    }

    await Promise.allSettled(jobs);
  };
}

/** Per-space coalescing: a burst of nudges inside the window runs once with
 *  the union of its changes. */
const pending = new Map<string, { changes: Set<SpaceChange>; timer: ReturnType<typeof setTimeout> }>();
export const CONFIG_SYNC_DEBOUNCE_MS = 400;

export function scheduleSpaceConfigSync(spaceId: string, changes: readonly SpaceChange[], dispatch: AppDispatch): void {
  const existing = pending.get(spaceId);
  if (existing) {
    for (const c of changes) existing.changes.add(c);
    return;
  }
  const timer = setTimeout(() => {
    const entry = pending.get(spaceId);
    pending.delete(spaceId);
    if (entry) void dispatch(syncSpaceConfig(spaceId, [...entry.changes]));
  }, CONFIG_SYNC_DEBOUNCE_MS);
  pending.set(spaceId, { changes: new Set(changes), timer });
}

/** Test-only. */
export function _resetPendingConfigSyncs(): void {
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
}
