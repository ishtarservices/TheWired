import type { UnsignedEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";
import type { RelayListEntry } from "../../types/relay";

/** Build an unsigned kind:0 metadata event */
export function buildProfileEvent(
  pubkey: string,
  profile: Kind0Profile,
): UnsignedEvent {
  const content: Record<string, string> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (value !== undefined && value !== "") {
      content[key] = value;
    }
  }

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 0,
    tags: [],
    content: JSON.stringify(content),
  };
}

/** Build an unsigned kind:9 chat message event */
export function buildChatMessage(
  pubkey: string,
  groupId: string,
  content: string,
  replyTo?: { eventId: string; pubkey: string },
  channelId?: string,
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

  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 9,
    tags,
    content: replyTo
      ? `nostr:nevent1${replyTo.eventId.slice(0, 16)}... ${content}`
      : content,
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
): UnsignedEvent {
  return {
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: 7,
    tags: [
      ["e", target.eventId],
      ["p", target.pubkey],
      ["k", String(target.kind)],
    ],
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

/** Build an unsigned kind:3 follow list event (NIP-02) */
export function buildFollowListEvent(
  pubkey: string,
  follows: string[],
): UnsignedEvent {
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
