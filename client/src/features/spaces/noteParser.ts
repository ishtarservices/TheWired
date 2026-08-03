import { parseThreadRef as coreParseThreadRef } from "@ishtarservices/core";

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
 * Parse NIP-10 thread references from "e" tags. rootId/replyId are
 * single-sourced from @ishtarservices/core (mobile parity — includes the fix
 * where a lone mention-marked e-tag no longer classifies as a reply, so
 * quote posts stop inflating reply counts/lists); mentionedPubkeys stays
 * a desktop concern (ThreadView reply indicator).
 */
export function parseThreadRef(event: NostrEvent): ThreadRef {
  const { rootId, replyId } = coreParseThreadRef(event);
  const mentionedPubkeys = event.tags
    .filter((t) => t[0] === "p")
    .map((t) => t[1])
    .filter(Boolean);
  return { rootId, replyId, mentionedPubkeys };
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
