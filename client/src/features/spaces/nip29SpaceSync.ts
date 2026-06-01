import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";
import type { Space } from "../../types/space";
import { store } from "../../store";
import { updateSpace, setChannels } from "../../store/slices/spacesSlice";
import { setMembers, setRoles } from "../../store/slices/spaceConfigSlice";
import { updateSpaceInStore } from "../../lib/db/spaceStore";
import { saveChannels } from "../../lib/db/channelStore";
import { isNip29Native, relayUrlToHost } from "./spaceType";
import { synthesizeNip29Members, synthesizeNip29Roles } from "./synthesizeNip29Roles";
import { parseLayoutEvent } from "./channelLayout";
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

/**
 * Apply a kind:30078 channel-layout overlay (M4) to a native space. The layout
 * is authored by an admin/creator/relay (NOT relay-only like 39000-2), and may
 * follow our `wired:layout:<groupId>` convention or Obelisk's
 * `obelisk:layout:<relayUrl>`. Returns true when handled as a layout for a
 * native space (so the pipeline doesn't treat it as anything else).
 */
export function applyNativeLayoutEvent(event: NostrEvent): boolean {
  const d = event.tags.find((t) => t[0] === "d")?.[1];
  if (!d) return false;

  const list = store.getState().spaces.list;
  let space: Space | undefined;
  if (d.startsWith("wired:layout:")) {
    const groupId = d.slice("wired:layout:".length);
    space = list.find((s) => s.id === groupId);
  } else if (d.startsWith("obelisk:layout:")) {
    // Obelisk keys layout by relay URL — match a native space on that host.
    space = list.find((s) => isNip29Native(s) && d.includes(relayUrlToHost(s.hostRelay)));
  } else {
    return false; // not a layout d-tag (e.g. DM read-state) — leave for others
  }
  if (!space || !isNip29Native(space)) return false;

  const channels = parseLayoutEvent(event, space); // null if unauthorized/empty
  if (!channels) return true;

  store.dispatch(setChannels({ spaceId: space.id, channels }));
  void saveChannels(space.id, channels).catch(() => {});
  if (space.channelSource !== "layout-event") {
    persist({ ...space, channelSource: "layout-event" });
  }
  return true;
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
