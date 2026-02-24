import type { NostrEvent } from "../../types/nostr";
import type { Space } from "../../types/space";
import { EVENT_KINDS } from "../../types/nostr";

/** Parse kind:39000 group metadata */
export function parseGroupMetadata(
  event: NostrEvent,
  hostRelay: string,
): Partial<Space> | null {
  if (event.kind !== EVENT_KINDS.GROUP_METADATA) return null;

  const dTag = event.tags.find((t) => t[0] === "d")?.[1];
  if (!dTag) return null;

  const name =
    event.tags.find((t) => t[0] === "name")?.[1] ?? dTag;
  const picture = event.tags.find((t) => t[0] === "picture")?.[1];
  const about = event.tags.find((t) => t[0] === "about")?.[1];
  const isPrivate = event.tags.some(
    (t) => t[0] === "closed" || t[0] === "private",
  );

  return {
    id: dTag,
    hostRelay,
    name,
    picture,
    about,
    isPrivate,
  };
}

/** Parse kind:39001 admin list */
export function parseGroupAdmins(event: NostrEvent): string[] {
  if (event.kind !== EVENT_KINDS.GROUP_ADMINS) return [];
  return event.tags
    .filter((t) => t[0] === "p" && t[1])
    .map((t) => t[1]);
}

/** Parse kind:39002 member list */
export function parseGroupMembers(event: NostrEvent): string[] {
  if (event.kind !== EVENT_KINDS.GROUP_MEMBERS) return [];
  return event.tags
    .filter((t) => t[0] === "p" && t[1])
    .map((t) => t[1]);
}
