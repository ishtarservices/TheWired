import type { UnsignedEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";
import type { RelayListEntry } from "../../types/relay";

/** Build an unsigned kind:0 metadata event.
 *
 *  Read-modify-write: `profile` (the edited fields) is merged OVER `base` (the
 *  last-known kind:0 content), so fields the editing UI doesn't model — lud06,
 *  NIP-57 pointers, custom keys — survive a republish instead of being wiped.
 *  An edited field set to "" removes that key (an intentional clear).
 *
 *  Throws if the resulting content would be empty — publishing an empty kind:0
 *  permanently wipes the user's profile on all relays. */
export function buildProfileEvent(
  pubkey: string,
  profile: Kind0Profile,
  base?: Kind0Profile,
): UnsignedEvent {
  const merged: Record<string, unknown> = { ...(base ?? {}), ...profile };
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(merged)) {
    // created_at is an event-level field, never profile content. The rest are
    // prototype-pollution keys: never assign them via bracket notation (it would
    // set `content`'s prototype) nor republish them out of preserved fields.
    if (key === "created_at" || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    if (value === undefined || value === null || value === "") continue;
    content[key] = value;
  }

  if (Object.keys(content).length === 0) {
    throw new Error("Refusing to build kind:0 with empty profile — this would wipe the user's metadata on all relays");
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
  };
}

/** File metadata for imeta tags (NIP-94 inline) */
export interface AttachmentMeta {
  url: string;
  mimeType: string;
  sha256: string;
  size: number;
}

/** Build an unsigned kind:9 chat message event */
export function buildChatMessage(
  pubkey: string,
  groupId: string,
  content: string,
  replyTo?: { eventId: string; pubkey: string },
  channelId?: string,
  attachments?: AttachmentMeta[],
  emojiTags?: string[][],
): UnsignedEvent {
  const tags: string[][] = [["h", groupId]];

  // Tag with channel ID so messages can be scoped per-channel
  if (channelId) {
    tags.push(["channel", channelId]);
  }

  if (replyTo) {
    tags.push(["q", replyTo.eventId]);
    tags.push(["p", replyTo.pubkey]);
  }

  // Add imeta tags for file attachments (NIP-94 inline metadata)
  if (attachments?.length) {
    for (const att of attachments) {
      tags.push([
        "imeta",
        `url ${att.url}`,
        `m ${att.mimeType}`,
        `x ${att.sha256}`,
        `size ${String(att.size)}`,
      ]);
    }
  }

  // Add NIP-30 custom emoji tags
  if (emojiTags?.length) {
    for (const tag of emojiTags) {
      tags.push(tag);
    }
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9,
    tags,
    content,
  };
}

/** Build an unsigned NIP-29 kind:9001 remove-user (kick) event. The relay
 *  enforces is_admin and republishes its members list (39002). */
export function buildRemoveUser(
  pubkey: string,
  groupId: string,
  targetPubkey: string,
  reason?: string,
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9001,
    tags: [["h", groupId], ["p", targetPubkey]],
    content: reason ?? "",
  };
}

/** Build an unsigned kind:1 root text note (NIP-10) */
export function buildRootNote(
  pubkey: string,
  content: string,
  mentionPubkeys?: string[],
  attachments?: AttachmentMeta[],
  emojiTags?: string[][],
): UnsignedEvent {
  const tags: string[][] = [];

  // Add mention p-tags
  if (mentionPubkeys?.length) {
    for (const pk of mentionPubkeys) {
      tags.push(["p", pk]);
    }
  }

  // Add imeta tags for file attachments (NIP-94 inline metadata)
  if (attachments?.length) {
    for (const att of attachments) {
      tags.push([
        "imeta",
        `url ${att.url}`,
        `m ${att.mimeType}`,
        `x ${att.sha256}`,
        `size ${String(att.size)}`,
      ]);
    }
  }

  // Add NIP-30 custom emoji tags
  if (emojiTags?.length) {
    for (const tag of emojiTags) {
      tags.push(tag);
    }
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags,
    content,
  };
}

/** Build an unsigned kind:10001 pinned notes list event (NIP-51) */
export function buildPinnedNotesEvent(
  pubkey: string,
  pinnedEventIds: string[],
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 10001,
    tags: pinnedEventIds.map((id) => ["e", id]),
    content: "",
  };
}

/** Derive a human-readable, URL-safe `d`-tag slug from an article title, with a
 *  short random suffix so two articles sharing a title don't collide. Falls back
 *  to a fully generated slug when the title has no usable characters (emoji-only,
 *  blank, non-Latin that strips to nothing). */
export function articleSlugFromTitle(title: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "") // drop accents so "déjà" → "deja"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base
    ? `${base}-${rand}`
    : `article-${Math.floor(Date.now() / 1000).toString(36)}-${rand}`;
}

/** Build an unsigned kind:30023 long-form article (NIP-23, addressable).
 *  `slug` becomes the `d` tag; a fresh one is derived from the title when omitted
 *  so each publish is a new article rather than overwriting an existing
 *  addressable. To EDIT an existing article, pass its current `slug` AND its
 *  original `publishedAt` so the address stays stable and the publish date is
 *  preserved (only `created_at` advances). When `spaceId` is set the article is
 *  scoped to that space (NIP-29 `h` tag) — publish it to the space host relay
 *  only for "space-exclusive" visibility. Mirrors music's space scoping. */
export function buildArticle(
  pubkey: string,
  params: {
    content: string;
    title: string;
    summary?: string;
    image?: string;
    slug?: string;
    hashtags?: string[];
    publishedAt?: number;
    spaceId?: string;
    channelId?: string;
  },
): UnsignedEvent {
  const now = Math.floor(Date.now() / 1000);
  const slug = params.slug?.trim() || articleSlugFromTitle(params.title);
  const tags: string[][] = [
    ["d", slug],
    ["title", params.title],
    ["published_at", String(params.publishedAt ?? now)],
  ];
  if (params.summary?.trim()) tags.push(["summary", params.summary.trim()]);
  if (params.image?.trim()) tags.push(["image", params.image.trim()]);
  for (const tag of params.hashtags ?? []) {
    const t = tag.trim().replace(/^#/, "");
    if (t) tags.push(["t", t.toLowerCase()]);
  }
  // Space-exclusive scoping (same shape as music's addVisibilityTags).
  if (params.spaceId) {
    tags.push(["h", params.spaceId]);
    if (params.channelId) tags.push(["channel", params.channelId]);
  }
  return {
    pubkey,
    created_at: now,
    kind: 30023,
    tags,
    content: params.content,
  };
}

/** Build an unsigned kind:1 reply event (NIP-10 threading) */
export function buildReply(
  pubkey: string,
  content: string,
  target: { eventId: string; pubkey: string; rootId?: string },
): UnsignedEvent {
  const rootId = target.rootId ?? target.eventId;
  const tags: string[][] = [
    ["e", rootId, "", "root"],
  ];
  if (target.eventId !== rootId) {
    tags.push(["e", target.eventId, "", "reply"]);
  }
  tags.push(["p", target.pubkey]);

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags,
    content,
  };
}

/** Build an unsigned kind:7 reaction event (NIP-25) */
export function buildReaction(
  pubkey: string,
  target: { eventId: string; pubkey: string; kind: number },
  content = "+",
  /** NIP-30 custom emoji tag: ["emoji", shortcode, url] */
  emojiTag?: string[],
): UnsignedEvent {
  const tags: string[][] = [
    ["e", target.eventId],
    ["p", target.pubkey],
    ["k", String(target.kind)],
  ];
  if (emojiTag) {
    tags.push(emojiTag);
  }
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 7,
    tags,
    content,
  };
}

/** Build an unsigned kind:6 repost event (NIP-18) */
export function buildRepost(
  pubkey: string,
  target: { id: string; pubkey: string },
  originalJson: string,
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 6,
    tags: [
      ["e", target.id],
      ["p", target.pubkey],
    ],
    content: originalJson,
  };
}

/** Build an unsigned kind:1 quote note with "q" tag */
export function buildQuoteNote(
  pubkey: string,
  content: string,
  target: { eventId: string; pubkey: string },
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [
      ["q", target.eventId, "", target.pubkey],
      ["p", target.pubkey],
    ],
    content,
  };
}

/** Build an unsigned kind:5 deletion event (NIP-09) */
export function buildDeletionEvent(
  pubkey: string,
  targets: {
    eventIds?: string[];
    addressableIds?: string[];
  },
  reason?: string,
  /** Extra "k" tags for non-addressable event kinds being deleted */
  kinds?: string[],
): UnsignedEvent {
  const tags: string[][] = [];

  // "e" tags for specific event IDs
  if (targets.eventIds) {
    for (const id of targets.eventIds) {
      tags.push(["e", id]);
    }
  }

  // "a" tags for addressable events (kind:pubkey:d-tag)
  if (targets.addressableIds) {
    for (const addr of targets.addressableIds) {
      tags.push(["a", addr]);
    }
  }

  // "k" tags for the kinds being deleted (helps relays filter)
  const kindSet = new Set<string>(kinds ?? []);
  if (targets.addressableIds) {
    for (const addr of targets.addressableIds) {
      const kind = addr.split(":")[0];
      if (kind) kindSet.add(kind);
    }
  }
  for (const k of kindSet) {
    tags.push(["k", k]);
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 5,
    tags,
    content: reason ?? "",
  };
}

// ── NIP-29 group management (Decentralized Spaces, native sub-type) ──────

/** Build an unsigned kind:9007 create-group event. The relay creates the group
 *  (creator becomes admin + member) and then emits 39000/39001/39002. `name`
 *  is carried in content for relays that seed metadata from it; pair with
 *  {@link buildEditGroupMetadata} for spec-compliant metadata tags. */
export function buildCreateGroup(
  pubkey: string,
  groupId: string,
  name: string,
  opts?: { isPrivate?: boolean; isClosed?: boolean },
): UnsignedEvent {
  const tags: string[][] = [["h", groupId]];
  // NIP-29 policy markers: private = members-only read, closed = join needs approval.
  if (opts?.isPrivate) tags.push(["private"]);
  if (opts?.isClosed) tags.push(["closed"]);
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9007,
    tags,
    content: name,
  };
}

/** Build an unsigned kind:9002 edit-group-metadata event (NIP-29). Metadata is
 *  carried in tags; the relay applies it and republishes kind:39000. */
export function buildEditGroupMetadata(
  pubkey: string,
  groupId: string,
  meta: { name?: string; about?: string; picture?: string },
): UnsignedEvent {
  const tags: string[][] = [["h", groupId]];
  if (meta.name) tags.push(["name", meta.name]);
  if (meta.about) tags.push(["about", meta.about]);
  if (meta.picture) tags.push(["picture", meta.picture]);
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9002,
    tags,
    content: "",
  };
}

/** Build an unsigned kind:9021 join-request event (NIP-29). Open groups
 *  auto-admit; closed groups require a valid invite `code` or admin approval. */
export function buildJoinRequest(
  pubkey: string,
  groupId: string,
  inviteCode?: string,
): UnsignedEvent {
  const tags: string[][] = [["h", groupId]];
  if (inviteCode) tags.push(["code", inviteCode]);
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9021,
    tags,
    content: "",
  };
}

/** Build an unsigned kind:9022 leave-group event (NIP-29). */
export function buildLeaveGroup(pubkey: string, groupId: string): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9022,
    tags: [["h", groupId]],
    content: "",
  };
}

/** Build an unsigned kind:9005 moderator deletion event (NIP-29) */
export function buildModDeletionEvent(
  pubkey: string,
  groupId: string,
  eventIds: string[],
  reason?: string,
): UnsignedEvent {
  const tags: string[][] = [["h", groupId]];
  for (const id of eventIds) {
    tags.push(["e", id]);
  }
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9005,
    tags,
    content: reason ?? "",
  };
}

/** Build an unsigned kind:9 edit event for a chat message */
export function buildChatEditEvent(
  pubkey: string,
  groupId: string,
  originalEventId: string,
  newContent: string,
  channelId?: string,
): UnsignedEvent {
  const tags: string[][] = [
    ["h", groupId],
    ["e", originalEventId, "", "edit"],
  ];
  if (channelId) {
    tags.push(["channel", channelId]);
  }
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9,
    tags,
    content: newContent,
  };
}

/** Build an unsigned kind:3 follow list event (NIP-02).
 *  Throws if the follow list is empty — publishing an empty kind:3
 *  permanently wipes the user's contact list on all relays. */
export function buildFollowListEvent(
  pubkey: string,
  follows: string[],
): UnsignedEvent {
  if (follows.length === 0) {
    throw new Error("Refusing to build kind:3 with empty follow list — this would wipe the user's contacts on all relays");
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 3,
    tags: follows.map((pk) => ["p", pk]),
    content: "",
  };
}

/** Build an unsigned kind:10000 mute list event (NIP-51) */
export function buildMuteListEvent(
  pubkey: string,
  mutes: Array<{ type: "pubkey" | "tag" | "word" | "event"; value: string }>,
): UnsignedEvent {
  const TAG_MAP: Record<string, string> = {
    pubkey: "p",
    tag: "t",
    word: "word",
    event: "e",
  };

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 10000,
    tags: mutes.map((m) => [TAG_MAP[m.type], m.value]),
    content: "",
  };
}

/** Build an unsigned kind:10002 relay list event (NIP-65) */
export function buildRelayListEvent(
  pubkey: string,
  relays: RelayListEntry[],
): UnsignedEvent {
  const tags: string[][] = relays.map((r) => {
    if (r.mode === "read") return ["r", r.url, "read"];
    if (r.mode === "write") return ["r", r.url, "write"];
    return ["r", r.url];
  });

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 10002,
    tags,
    content: "",
  };
}

/** Build an unsigned kind:10050 DM relay list event (NIP-17) */
export function buildDMRelayListEvent(
  pubkey: string,
  relayUrls: string[],
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 10050,
    tags: relayUrls.map((url) => ["relay", url]),
    content: "",
  };
}

export interface PollOptionInput {
  id: string;
  label: string;
  /** Optional music-track address ("31683:pubkey:dTag") — emitted as our
   *  supplemental ["track", optionId, addr] tag (additive to NIP-88). */
  trackAddress?: string;
}

/** Build an unsigned NIP-88 kind:1068 poll event.
 *  Space-scoped polls carry h/channel tags (NIP-29) so they land in the
 *  chat timeline and pass strict group-relay membership gates. */
export function buildPollEvent(
  pubkey: string,
  question: string,
  options: PollOptionInput[],
  opts: {
    pollType?: "singlechoice" | "multiplechoice";
    /** Unix seconds */
    endsAt?: number;
    relays?: string[];
    spaceId?: string;
    channelId?: string;
  } = {},
): UnsignedEvent {
  const tags: string[][] = [];

  for (const option of options) {
    tags.push(["option", option.id, option.label]);
  }
  for (const option of options) {
    if (option.trackAddress) {
      tags.push(["track", option.id, option.trackAddress]);
    }
  }
  for (const url of opts.relays ?? []) {
    tags.push(["relay", url]);
  }
  tags.push(["polltype", opts.pollType ?? "singlechoice"]);
  if (opts.endsAt !== undefined) {
    tags.push(["endsAt", String(opts.endsAt)]);
  }
  if (opts.spaceId) {
    tags.push(["h", opts.spaceId]);
    if (opts.channelId) {
      tags.push(["channel", opts.channelId]);
    }
  }
  tags.push(["alt", `Poll: ${question}`]);

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1068,
    tags,
    content: question,
  };
}

/** Build an unsigned NIP-88 kind:1018 poll vote. Re-voting replaces the
 *  previous vote (latest created_at per pubkey wins). */
export function buildPollVote(
  pubkey: string,
  pollEventId: string,
  optionIds: string[],
  opts: { spaceId?: string } = {},
): UnsignedEvent {
  const tags: string[][] = [["e", pollEventId]];
  for (const id of optionIds) {
    tags.push(["response", id]);
  }
  // h tag so strict NIP-29 relays accept the vote from group members
  if (opts.spaceId) {
    tags.push(["h", opts.spaceId]);
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1018,
    tags,
    content: "",
  };
}
