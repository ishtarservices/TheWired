// NIP-10 (threads) + NIP-18 (quotes) classification and pure thread-tree
// construction. Single-sourced here so desktop and mobile classify replies
// identically; supersedes the mobile copy in apps/mobile/src/lib/nostr/
// noteTags.ts (now a re-export shim) and, eventually, the desktop copy in
// client/src/features/spaces/noteParser.ts.
//
// Unlike the older copies, the single-e-tag positional path here excludes
// `mention`-marked tags: a quote-post whose only e-tag is a mention is NOT a
// reply (it previously inflated reply counts and thread lists).

import type { NostrEvent } from "@thewired/shared-types";

export interface ThreadRef {
  rootId: string | null;
  replyId: string | null;
}

/**
 * Parse NIP-10 thread references from "e" tags. Supports both marked
 * (root/reply) and deprecated positional formats; `mention`-marked tags
 * never classify as thread references.
 */
export function parseThreadRef(event: NostrEvent): ThreadRef {
  const eTags = event.tags.filter((t) => t[0] === "e");

  // Marked format first (NIP-10 preferred).
  const rootTag = eTags.find((t) => t[3] === "root");
  const replyTag = eTags.find((t) => t[3] === "reply");
  if (rootTag || replyTag) {
    return {
      rootId: rootTag?.[1] ?? replyTag?.[1] ?? null,
      replyId: replyTag?.[1] ?? rootTag?.[1] ?? null,
    };
  }

  // Deprecated positional fallback:
  // 1 e-tag = root, 2+ e-tags = first is root, last is reply.
  const nonMention = eTags.filter((t) => t[3] !== "mention");
  if (nonMention.length === 1) {
    return { rootId: nonMention[0]?.[1] ?? null, replyId: nonMention[0]?.[1] ?? null };
  }
  if (nonMention.length >= 2) {
    return {
      rootId: nonMention[0]?.[1] ?? null,
      replyId: nonMention[nonMention.length - 1]?.[1] ?? null,
    };
  }

  return { rootId: null, replyId: null };
}

export interface QuoteRef {
  eventId: string;
  relayHint?: string;
  pubkey?: string;
}

/** NIP-18 quote reference — first "q" tag, if any. */
export function parseQuoteRef(event: NostrEvent): QuoteRef | null {
  const tag = event.tags.find((t) => t[0] === "q" && !!t[1]);
  if (!tag) return null;
  return {
    eventId: tag[1] as string,
    relayHint: tag[2] || undefined,
    pubkey: tag[3] || undefined,
  };
}

/**
 * A quote-post that references other events without replying to any:
 * a `q` tag or mention-only e-tags, with no NIP-10 thread reference.
 * These must never appear in reply lists or counts.
 */
export function isQuoteOnly(event: NostrEvent): boolean {
  if (parseThreadRef(event).rootId !== null) return false;
  return event.tags.some((t) => (t[0] === "q" || t[0] === "e") && !!t[1]);
}

/** The immediate parent a reply targets — reply marker, else root. */
export function directParentId(event: NostrEvent): string | null {
  const ref = parseThreadRef(event);
  return ref.replyId ?? ref.rootId;
}

/** True when `event` is a direct reply to `parentId` (not a deeper descendant). */
export function isDirectReply(event: NostrEvent, parentId: string): boolean {
  return directParentId(event) === parentId;
}

/** Deterministic order — created_at asc, event-id tiebreak — so merges from
 *  any source order (cache-then-live, live-then-cache) converge. */
export function compareEventsChrono(a: NostrEvent, b: NostrEvent): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

// ─── Thread tree ────────────────────────────────────────────────────────

export interface ThreadNode {
  event: NostrEvent;
  /** Direct replies, compareEventsChrono order. */
  children: ThreadNode[];
  /** Total subtree size below this node (all depths). */
  descendants: number;
  /** Declared parent wasn't fetched (or was unreachable) — re-parented to root. */
  orphan: boolean;
}

export interface ThreadTree {
  rootId: string;
  focusId: string;
  /** Root note + full reply tree; null when the root event wasn't fetched. */
  root: ThreadNode | null;
  /** Focused note + its reply subtree; null when the focus event wasn't fetched. */
  focus: ThreadNode | null;
  /** Known ancestor chain above the focus, oldest first (root-first when complete). */
  ancestors: NostrEvent[];
  /** True when the ancestor chain connects all the way to rootId. */
  ancestorsComplete: boolean;
}

/**
 * Build the conversation tree for one thread from a raw event set (typically
 * the result of fetching `{ids:[rootId]}` + `{kinds:[1],"#e":[rootId]}`).
 *
 * - Quote-only events and non-thread kind-1s are excluded.
 * - Events whose parent is missing/unreachable but whose refs point into this
 *   conversation attach under the root as `orphan` (everything fetched shows).
 * - Cycles terminate via a visited set; each event appears at most once.
 * - Mute filtering is deliberately NOT done here — render substitutes a
 *   placeholder for muted authors so their children stay reachable.
 */
export function buildThreadTree(
  events: readonly NostrEvent[],
  opts: { rootId: string; focusId: string },
): ThreadTree {
  const { rootId, focusId } = opts;

  const byId = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== 1) continue;
    if (!byId.has(event.id)) byId.set(event.id, event);
  }

  // Parent → direct children adjacency. Only genuine replies participate.
  const childrenOf = new Map<string, NostrEvent[]>();
  for (const event of byId.values()) {
    if (event.id === rootId) continue;
    const parent = directParentId(event);
    if (!parent || parent === event.id) continue;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(event);
    else childrenOf.set(parent, [event]);
  }

  const visited = new Set<string>();
  const nodesById = new Map<string, ThreadNode>();

  function buildNode(event: NostrEvent, orphan: boolean): ThreadNode {
    visited.add(event.id);
    const children = (childrenOf.get(event.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort(compareEventsChrono)
      .map((child) => buildNode(child, false));
    const descendants = children.reduce((sum, c) => sum + 1 + c.descendants, 0);
    const node: ThreadNode = { event, children, descendants, orphan };
    nodesById.set(event.id, node);
    return node;
  }

  const rootEvent = byId.get(rootId);
  const root = rootEvent ? buildNode(rootEvent, false) : null;

  // Re-attach unreached events that belong to this conversation (missing or
  // muted-out parents, cycles, non-compliant taggers) under the root.
  if (root) {
    const strays = [...byId.values()]
      .filter((event) => {
        if (visited.has(event.id)) return false;
        const ref = parseThreadRef(event);
        if (ref.rootId === null) return false;
        return (
          ref.rootId === rootId ||
          byId.has(ref.rootId) ||
          (ref.replyId !== null && byId.has(ref.replyId))
        );
      })
      .sort(compareEventsChrono);
    for (const stray of strays) {
      if (visited.has(stray.id)) continue; // pulled in by an earlier stray's subtree
      root.children.push(buildNode(stray, true));
    }
    if (strays.length > 0) {
      root.children.sort((a, b) => compareEventsChrono(a.event, b.event));
      root.descendants = root.children.reduce((sum, c) => sum + 1 + c.descendants, 0);
    }
  }

  // Focus subtree — normally reached from the root walk; built directly when
  // the root event is missing.
  let focus = nodesById.get(focusId) ?? null;
  if (!focus) {
    const focusEvent = byId.get(focusId);
    if (focusEvent && !visited.has(focusId)) focus = buildNode(focusEvent, false);
  }

  // Ancestor chain: walk parent pointers up from the focus (hop cap + visited
  // set guard against pathological tag graphs).
  const ancestors: NostrEvent[] = [];
  let ancestorsComplete = focusId === rootId;
  const focusEvent = byId.get(focusId);
  if (focusEvent && focusId !== rootId) {
    const walked = new Set<string>([focusId]);
    let parentId = directParentId(focusEvent);
    for (let hops = 0; parentId && !walked.has(parentId) && hops < 100; hops++) {
      const parentEvent = byId.get(parentId);
      if (!parentEvent) break;
      ancestors.unshift(parentEvent);
      walked.add(parentId);
      if (parentId === rootId) {
        ancestorsComplete = true;
        break;
      }
      parentId = directParentId(parentEvent);
    }
  }

  return { rootId, focusId, root, focus, ancestors, ancestorsComplete };
}

// ─── Flattening for list rendering ──────────────────────────────────────

/** Sentinel for the `expanded` set: the collapsed ancestor chain. */
export const ANCESTORS_EXPANDED_KEY = "ancestors";

export type ThreadRow =
  | { key: string; kind: "ancestor"; event: NostrEvent; isRoot: boolean }
  /** Collapsed/unknown links in the ancestor chain. `hiddenCount` counts known
   *  collapsed events; `unknownDepth` means the chain doesn't reach the root. */
  | { key: string; kind: "ancestor-gap"; hiddenCount: number; unknownDepth: boolean }
  | { key: string; kind: "focus"; event: NostrEvent }
  | { key: string; kind: "load-older" }
  | { key: string; kind: "reply"; event: NostrEvent; depth: number; orphan: boolean }
  | { key: string; kind: "expander"; parentId: string; hiddenCount: number; depth: number };

export interface FlattenOptions {
  /** Ids whose collapsed subtrees are open; ANCESTORS_EXPANDED_KEY for the chain. */
  expanded: ReadonlySet<string>;
  /** Indent clamp — children of nodes at this depth collapse behind expanders. */
  maxDepth?: number;
  /** Compact ancestor rows shown while the chain is collapsed. */
  maxAncestors?: number;
  /** The reply fetch hit its limit — emit a load-older affordance. */
  truncated?: boolean;
}

/**
 * Flatten a ThreadTree into FlatList rows: bounded ancestor block, focus,
 * optional load-older, then the reply tree with depth-clamped expanders.
 * Row keys are stable across recomputes (event ids + deterministic sentinels).
 */
export function flattenThread(tree: ThreadTree, opts: FlattenOptions): ThreadRow[] {
  const { expanded, truncated = false } = opts;
  const maxDepth = Math.max(1, opts.maxDepth ?? 2);
  const maxAncestors = Math.max(2, opts.maxAncestors ?? 2);

  const rows: ThreadRow[] = [];
  if (!tree.focus) return rows;

  if (tree.focusId !== tree.rootId) {
    const chain = tree.ancestors;
    const unknownDepth = !tree.ancestorsComplete;
    const gap = (hiddenCount: number): ThreadRow => ({
      key: "gap:ancestors",
      kind: "ancestor-gap",
      hiddenCount,
      unknownDepth,
    });
    const ancestorRow = (event: NostrEvent, isRoot: boolean): ThreadRow => ({
      key: event.id,
      kind: "ancestor",
      event,
      isRoot,
    });

    if (expanded.has(ANCESTORS_EXPANDED_KEY) || chain.length <= maxAncestors) {
      if (unknownDepth) rows.push(gap(0));
      chain.forEach((event, i) =>
        rows.push(ancestorRow(event, tree.ancestorsComplete && i === 0)),
      );
    } else {
      const first = chain[0] as NostrEvent;
      const last = chain[chain.length - 1] as NostrEvent;
      rows.push(ancestorRow(first, tree.ancestorsComplete));
      rows.push(gap(chain.length - 2));
      rows.push(ancestorRow(last, false));
    }
  }

  rows.push({ key: tree.focus.event.id, kind: "focus", event: tree.focus.event });
  if (truncated) rows.push({ key: "older", kind: "load-older" });

  const walkReplies = (node: ThreadNode, depth: number): void => {
    for (const child of node.children) {
      const clamped = Math.min(depth, maxDepth);
      rows.push({
        key: child.event.id,
        kind: "reply",
        event: child.event,
        depth: clamped,
        orphan: child.orphan,
      });
      if (child.children.length === 0) continue;
      if (clamped < maxDepth || expanded.has(child.event.id)) {
        walkReplies(child, depth + 1);
      } else {
        rows.push({
          key: `x:${child.event.id}`,
          kind: "expander",
          parentId: child.event.id,
          hiddenCount: child.descendants,
          depth: clamped,
        });
      }
    }
  };
  walkReplies(tree.focus, 1);

  return rows;
}
