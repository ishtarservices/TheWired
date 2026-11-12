import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import type { Space } from "../../types/space";
import { store } from "../../store";
import { updateSpace, setChannelLayout } from "../../store/slices/spacesSlice";
import { setMembers, setRoles } from "../../store/slices/spaceConfigSlice";
import { updateSpaceInStore } from "../../lib/db/spaceStore";
import { saveChannels, saveCategories } from "../../lib/db/channelStore";
import { isNip29Native } from "./spaceType";
import { synthesizeNip29Members, synthesizeNip29Roles } from "./synthesizeNip29Roles";
import {
  pickLayout,
  obeliskLayoutDTags,
  wiredLayoutDTag,
  authorizedLayoutAuthors,
  defaultNativeChannels,
} from "./channelLayout";
import { parseRelaySetEvent, wiredRelaysDTag } from "./relaySet";

/**
 * Applies relay-sourced NIP-29 group state (kind 39000/39001/39002) to a
 * relay-authoritative ("nip29-native") space: updates the space metadata and
 * re-synthesizes the members/roles the rest of the UI reads. All data here
 * comes from an arbitrary relay's master key, so it is treated as untrusted and
 * sanitized (image URLs http(s)-only, name/about kept as plain text).
 *
 * Returns true when the event was handled as native state — the caller (the
 * event pipeline) uses this to decide whether to fall through to the backend
 * member-sync path (platform / A-lite spaces).
 */
export function applyNativeGroupEvent(event: NostrEvent): boolean {
  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (!dTag) return false;

  const space = store.getState().spaces.list.find((s) => s.id === dTag);
  if (!space || !isNip29Native(space)) return false;

  // SECURITY: group state (39000/39001/39002) is only trustworthy from the
  // relay's master key (NIP-29: the relay is the authority). A valid schnorr sig
  // is NOT enough — any pubkey can publish a kind-39002 with a matching d-tag and
  // forge the member/admin list. Pin the expected author. Fail closed when the
  // relay's pubkey is unknown (we mark it handled so it never falls through to a
  // backend sync, but apply nothing).
  if (!space.relayPubkey || event.pubkey !== space.relayPubkey) {
    return true;
  }

  switch (event.kind) {
    case EVENT_KINDS.GROUP_METADATA: {
      const meta = parseGroupMetadata(event);
      const updated: Space = {
        ...space,
        name: meta.name ?? space.name,
        about: meta.about ?? space.about,
        picture: meta.picture ?? space.picture,
        isPrivate: meta.isPrivate ?? space.isPrivate,
      };
      persist(updated);
      return true;
    }
    case EVENT_KINDS.GROUP_ADMINS: {
      const admins = pubkeysFromPTags(event);
      const updated: Space = { ...space, adminPubkeys: admins };
      persist(updated);
      resynthesize(updated);
      // Who may author the layout changed: re-pick among the layouts already
      // seen (one may have arrived before the admin list) and let the layout
      // subscription re-filter by the new authors.
      repickLayout(updated);
      for (const listener of adminListeners) listener(updated);
      return true;
    }
    case EVENT_KINDS.GROUP_MEMBERS: {
      const members = pubkeysFromPTags(event);
      const updated: Space = { ...space, memberPubkeys: members };
      persist(updated);
      resynthesize(updated);
      return true;
    }
    default:
      return false;
  }
}

/** Layout events seen per native space, latest per (author, d-tag). Bounded.
 *  Kept for the session (not dropped when switching spaces): the relay's
 *  re-delivery on re-entry is deduplicated by the pipeline and would never
 *  repopulate it. Dropped when the space itself is removed. */
const layoutCandidates = new Map<string, Map<string, NostrEvent>>();
/** Spaces whose layout subscription has delivered what the relay holds. */
const layoutLoaded = new Set<string>();
/** The event id currently applied per space, and its created_at. */
const appliedLayout = new Map<string, { id: string; createdAt: number }>();
const MAX_LAYOUT_CANDIDATES = 32;

type AdminsListener = (space: Space) => void;
const adminListeners = new Set<AdminsListener>();

/** Run `listener` whenever a native space's admin list (layout authors) changes. */
export function onNativeAdminsChanged(listener: AdminsListener): () => void {
  adminListeners.add(listener);
  return () => adminListeners.delete(listener);
}

/** created_at of the layout currently applied to a space (a new one must be later). */
export function appliedLayoutCreatedAt(spaceId: string): number | undefined {
  return appliedLayout.get(spaceId)?.createdAt;
}

/** Forget a space's layout candidates (the space was removed). */
export function forgetNativeLayout(spaceId: string): void {
  layoutCandidates.delete(spaceId);
  appliedLayout.delete(spaceId);
  layoutLoaded.delete(spaceId);
}

/** Whether the layout subscription has caught up — writes before that could
 *  publish over a layout this client hasn't seen yet. */
export function setNativeLayoutLoaded(spaceId: string, loaded: boolean): void {
  if (loaded) layoutLoaded.add(spaceId);
  else layoutLoaded.delete(spaceId);
}

export function isNativeLayoutLoaded(spaceId: string): boolean {
  return layoutLoaded.has(spaceId);
}

/** Newest created_at among a space's authorized layouts (a new one must be
 *  later). Strangers' events don't count: they must not push our dates. */
export function newestLayoutCreatedAt(spaceId: string): number | undefined {
  const space = store.getState().spaces.list.find((s) => s.id === spaceId);
  const authors = new Set(space ? authorizedLayoutAuthors(space) : []);
  const dates = [...(layoutCandidates.get(spaceId)?.values() ?? [])]
    .filter((e) => authors.has(e.pubkey))
    .map((e) => e.created_at);
  const applied = appliedLayout.get(spaceId)?.createdAt;
  if (applied !== undefined) dates.push(applied);
  return dates.length > 0 ? Math.max(...dates) : undefined;
}

/**
 * Apply a kind:30078 channel-layout overlay to a native space. The layout is
 * authored by an admin/creator/relay (NOT relay-only like 39000-2), and may
 * follow our `wired:layout:<groupId>` convention or Obelisk's
 * `obelisk:layout:<relayUrl>`. Every event is kept as a candidate and the
 * binding one is re-picked (newest authorized; ours over Obelisk's), so arrival
 * order — relays return newest first — can't let an older layout win, and a
 * layout that arrives before the admin list isn't lost. Returns true when
 * handled as a layout for a native space.
 */
export function applyNativeLayoutEvent(event: NostrEvent): boolean {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (!d) return false;

  const list = store.getState().spaces.list;
  let space: Space | undefined;
  if (d.startsWith("wired:layout:")) {
    const groupId = d.slice("wired:layout:".length);
    space = list.find((s) => s.id === groupId && wiredLayoutDTag(s.id) === d);
  } else if (d.startsWith("obelisk:layout:")) {
    // Obelisk keys layout by relay URL — match a native space on that host.
    space = list.find((s) => isNip29Native(s) && obeliskLayoutDTags(s).includes(d));
  } else {
    return false; // not a layout d-tag (e.g. DM read-state) — leave for others
  }
  if (!space || !isNip29Native(space)) return false;

  let bucket = layoutCandidates.get(space.id);
  if (!bucket) layoutCandidates.set(space.id, (bucket = new Map()));
  const key = `${event.pubkey}|${d}`;
  const prev = bucket.get(key);
  if (!prev || event.created_at > prev.created_at || (event.created_at === prev.created_at && event.id < prev.id)) {
    bucket.set(key, event);
  }
  if (bucket.size > MAX_LAYOUT_CANDIDATES) {
    // Evict strangers' events first, then the oldest — never the applied one.
    const authors = new Set(authorizedLayoutAuthors(space));
    const appliedId = appliedLayout.get(space.id)?.id;
    const victims = [...bucket.entries()]
      .filter(([, e]) => e.id !== appliedId)
      .sort(
        (a, b) =>
          Number(authors.has(a[1].pubkey)) - Number(authors.has(b[1].pubkey)) || a[1].created_at - b[1].created_at,
      );
    for (const [k] of victims.slice(0, bucket.size - MAX_LAYOUT_CANDIDATES)) bucket.delete(k);
  }
  repickLayout(space);
  return true;
}

/** Apply the binding layout among a space's candidates, if it changed. */
function repickLayout(space: Space): void {
  const bucket = layoutCandidates.get(space.id);
  if (!bucket || !isNip29Native(space)) return;
  const picked = pickLayout([...bucket.values()], space);
  if (!picked) {
    // The layout we showed is no longer authorized (its author was removed as
    // an admin): back to the plain single chat until an admin publishes one.
    if (appliedLayout.has(space.id)) {
      appliedLayout.delete(space.id);
      const channels = defaultNativeChannels(space.id);
      store.dispatch(setChannelLayout({ spaceId: space.id, channels, categories: [] }));
      void saveChannels(space.id, channels).catch(() => {});
      void saveCategories(space.id, { categories: [] }).catch(() => {});
    }
    return;
  }
  if (appliedLayout.get(space.id)?.id === picked.event.id) return;
  appliedLayout.set(space.id, { id: picked.event.id, createdAt: picked.event.created_at });

  const { channels, categories, convention } = picked.layout;
  store.dispatch(setChannelLayout({ spaceId: space.id, channels, categories }));
  void saveChannels(space.id, channels).catch(() => {});
  void saveCategories(space.id, { categories }).catch(() => {});
  if (space.channelSource !== "layout-event" || space.layoutConvention !== convention) {
    persist({ ...space, channelSource: "layout-event", layoutConvention: convention });
  }
}

/**
 * Apply a kind:30078 relay-set overlay (`wired:relays:<groupId>`, M9) to a
 * space: learn its mirror relays so the client can read-from-any /
 * publish-to-all. Returns true when handled as a relay set (so the pipeline
 * doesn't also treat it as a layout / DM read-state event).
 */
export function applyNativeRelaySetEvent(event: NostrEvent): boolean {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (!d || !d.startsWith("wired:relays:")) return false;

  const groupId = d.slice("wired:relays:".length);
  const space = store.getState().spaces.list.find((s) => s.id === groupId);
  if (!space || wiredRelaysDTag(space.id) !== d) return true;

  const parsed = parseRelaySetEvent(event, space); // null if unauthorized
  if (!parsed) return true;

  // Store authority + mirrors; resolveRelaySet() dedupes hostRelay back out.
  const relayUrls = Array.from(
    new Set([...(parsed.authority ? [parsed.authority] : []), ...parsed.mirrors]),
  );
  const same =
    space.relayUrls?.length === relayUrls.length &&
    relayUrls.every((u) => space.relayUrls?.includes(u));
  if (!same) persist({ ...space, relayUrls });
  return true;
}

/** Push the updated space to Redux + IndexedDB (so it survives a restart). */
function persist(updated: Space): void {
  store.dispatch(updateSpace(updated));
  void updateSpaceInStore(updated).catch(() => {});
}

/** Re-derive the synthetic roles + members the MemberList/permissions UI reads. */
function resynthesize(space: Space): void {
  store.dispatch(setRoles({ spaceId: space.id, roles: synthesizeNip29Roles(space.id) }));
  store.dispatch(
    setMembers({
      spaceId: space.id,
      members: synthesizeNip29Members(space.id, space.memberPubkeys, space.adminPubkeys),
    }),
  );
}

/**
 * Seed a native space's synthetic roles/members from its currently-known
 * admin/member pubkeys (e.g. on creation or on entering before the relay's
 * 39001/39002 arrive). Idempotent — the relay events will refine it.
 */
export function seedNativeSpaceConfig(space: Space): void {
  resynthesize(space);
}

/** p-tag pubkeys from a 39001/39002 event (deduped, non-empty). */
function pubkeysFromPTags(event: NostrEvent): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === "p" && tag[1] && !seen.has(tag[1])) {
      seen.add(tag[1]);
      out.push(tag[1]);
    }
  }
  return out;
}

interface ParsedGroupMetadata {
  name?: string;
  about?: string;
  picture?: string;
  isPrivate?: boolean;
}

/**
 * Parse kind:39000. Prefers NIP-29 marker tags (`name`/`picture`/`about`,
 * `private`/`public`), falling back to a JSON `content` blob (the convention
 * our relay and some others use). All untrusted — image URLs are http(s)-gated.
 */
export function parseGroupMetadata(event: NostrEvent): ParsedGroupMetadata {
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];

  let name = tag("name");
  let about = tag("about");
  let picture = tag("picture");
  const hasPrivate = event.tags.some((t) => t[0] === "private");
  const hasPublic = event.tags.some((t) => t[0] === "public");
  let isPrivate: boolean | undefined = hasPrivate ? true : hasPublic ? false : undefined;

  // Fall back to a JSON content blob for fields not present as tags.
  if ((!name || !about || !picture) && event.content) {
    try {
      const c = JSON.parse(event.content) as Record<string, unknown>;
      if (!name && typeof c.name === "string") name = c.name;
      if (!about && typeof c.about === "string") about = c.about;
      if (!picture && typeof c.picture === "string") picture = c.picture;
      if (isPrivate === undefined && typeof c.private === "boolean") isPrivate = c.private;
    } catch {
      // content isn't JSON — ignore.
    }
  }

  return {
    // Cap lengths — a malicious relay could otherwise send a multi-MB name/about
    // that bloats Redux/IndexedDB. These are display fields; trim hard.
    name: cap(name?.trim(), 200),
    about: cap(about?.trim(), 2000),
    picture: safeImageUrl(picture),
    isPrivate,
  };
}

/** Trim a string to a max length, returning undefined when empty. */
function cap(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** Allow only http(s) image URLs; reject javascript:/data:/other schemes. */
function safeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
