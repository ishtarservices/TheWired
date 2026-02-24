import type { NostrFilter } from "../../types/nostr";
import type { ChannelRoute } from "../../types/space";

/** Build a Nostr filter for a channel within a group */
export function buildChannelFilter(
  route: ChannelRoute,
  groupId: string,
  opts?: {
    since?: number;
    until?: number;
    limit?: number;
    adminPubkeys?: string[];
  },
): NostrFilter {
  const filter: NostrFilter = {
    kinds: route.kinds,
    limit: opts?.limit ?? route.pageSize,
  };

  if (route.usesHTag) {
    filter["#h"] = [groupId];
  }

  if (route.adminOnly && opts?.adminPubkeys) {
    filter.authors = opts.adminPubkeys;
  }

  if (opts?.since) filter.since = opts.since;
  if (opts?.until) filter.until = opts.until;

  return filter;
}

/** Build a filter for fetching user metadata */
export function buildProfileFilter(pubkeys: string[]): NostrFilter {
  return { kinds: [0], authors: pubkeys };
}

/** Build a filter for user's relay list (kind:10002) */
export function buildRelayListFilter(pubkey: string): NostrFilter {
  return { kinds: [10002], authors: [pubkey] };
}

/** Build filters for user's follow list + mute list */
export function buildUserListsFilter(pubkey: string): NostrFilter {
  return { kinds: [3, 10000], authors: [pubkey] };
}

/** Build a filter for a user's text notes (kind:1) */
export function buildNotesFilter(
  pubkey: string,
  limit = 50,
): NostrFilter {
  return { kinds: [1], authors: [pubkey], limit };
}

/** Build a filter for followers (kind:3 events that tag this pubkey) */
export function buildFollowersFilter(pubkey: string): NostrFilter {
  return { kinds: [3], "#p": [pubkey], limit: 500 };
}

/** Build a filter for a space feed channel (author-scoped) */
export function buildSpaceFeedFilter(
  memberPubkeys: string[],
  kinds: number[],
  limit: number,
): NostrFilter {
  return { authors: memberPubkeys, kinds, limit };
}
