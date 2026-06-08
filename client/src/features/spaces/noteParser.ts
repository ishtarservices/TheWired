import type { NostrEvent } from "../../types/nostr";

export interface ThreadRef {
  rootId: string | null;
  replyId: string | null;
  mentionedPubkeys: string[];
}

export interface QuoteRef {
  eventId: string;
  relayHint: string;
  pubkey: string;
}

/**
 * Parse NIP-10 thread references from "e" tags.
 * Supports both marked (root/reply) and deprecated positional formats.
 */
export function parseThreadRef(event: NostrEvent): ThreadRef {
  const eTags = event.tags.filter((t) => t[0] === "e");
  const pTags = event.tags.filter((t) => t[0] === "p");

  const mentionedPubkeys = pTags.map((t) => t[1]).filter(Boolean);

  // Try marked format first (NIP-10 preferred)
  const rootTag = eTags.find((t) => t[3] === "root");
  const replyTag = eTags.find((t) => t[3] === "reply");

  if (rootTag || replyTag) {
    return {
      rootId: rootTag?.[1] ?? replyTag?.[1] ?? null,
      replyId: replyTag?.[1] ?? rootTag?.[1] ?? null,
      mentionedPubkeys,
    };
  }

  // Deprecated positional fallback:
  // 1 e-tag = root, 2+ e-tags = first is root, last is reply
  if (eTags.length === 1) {
    return {
      rootId: eTags[0]?.[1] ?? null,
      replyId: eTags[0]?.[1] ?? null,
      mentionedPubkeys,
    };
  }
  if (eTags.length >= 2) {
    // Filter out "mention" marked tags
    const nonMention = eTags.filter((t) => t[3] !== "mention");
    if (nonMention.length >= 2) {
      return {
        rootId: nonMention[0]?.[1] ?? null,
        replyId: nonMention[nonMention.length - 1]?.[1] ?? null,
        mentionedPubkeys,
      };
    }
    if (nonMention.length === 1) {
      return {
        rootId: nonMention[0]?.[1] ?? null,
        replyId: nonMention[0]?.[1] ?? null,
        mentionedPubkeys,
      };
    }
  }

  return { rootId: null, replyId: null, mentionedPubkeys };
}

/** Parse NIP-18 "q" tag for quote references */
export function parseQuoteRef(event: NostrEvent): QuoteRef | null {
  const qTag = event.tags.find((t) => t[0] === "q");
  if (!qTag || !qTag[1]) return null;
  return {
    eventId: qTag[1],
    relayHint: qTag[2] ?? "",
    pubkey: qTag[3] ?? "",
  };
}

/** Returns true if the event is a root note (not a reply) */
export function isRootNote(event: NostrEvent): boolean {
  if (event.kind !== 1) return false;
  const ref = parseThreadRef(event);
  return ref.rootId === null;
}

/**
 * Returns true if `event` is a DIRECT reply to `parentId` (its immediate
 * parent), not a deeper descendant. The events store indexes a reply under both
 * its NIP-10 root and its immediate parent, so `replies[rootId]` is the whole
 * flattened subtree; this filters that down to one thread level.
 */
export function isDirectReply(event: NostrEvent, parentId: string): boolean {
  const ref = parseThreadRef(event);
  // The reply marker is the immediate parent; fall back to root for top-level
  // replies that only carry a root tag.
  return (ref.replyId ?? ref.rootId) === parentId;
}

/** Parse NIP-25 reaction content */
export function parseReactionContent(event: NostrEvent): string {
  const c = event.content.trim();
  if (c === "" || c === "+") return "+";
  if (c === "-") return "-";
  return c;
}
