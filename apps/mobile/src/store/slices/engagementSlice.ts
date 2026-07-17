// Per-note engagement aggregates — reactions (kind 7), reposts (kind 6) and
// replies (kind 1 #e) collapse to tiny entries instead of full signed events
// (desktop reactionsSlice pattern, ~70 bytes/reaction). Zaps stay in
// zapsSlice. Counts derive from selectors, never stored. Bounded two ways:
// PER_TARGET_CAP saturates hot notes, TARGET_CAP FIFO-evicts whole targets so
// the slice can't outgrow the feed it serves.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Per-note saturation (desktop ENGAGEMENT_INDEX_CAP parity). */
export const PER_TARGET_CAP = 300;
/** Max tracked targets (~2× FEED_CAP); oldest 100 evicted when exceeded. */
export const TARGET_CAP = 400;
const TARGET_EVICT_BATCH = 100;

/** A reaction's reactor + content, keyed by its kind:7 event id. */
interface ReactionEntry {
  reactor: string;
  content: string;
}

interface EngagementState {
  /** targetEventId → reactionEventId → {reactor, content}. Keyed by event id
   *  so re-delivery dedups; NIP-25 "" ⇒ "+". */
  reactionsByTarget: Record<string, Record<string, ReactionEntry>>;
  /** reactionEventId → targetEventId (kind-5 deletions later + O(1) dedup). */
  reactionIndex: Record<string, string>;
  /** targetEventId → repostEventId → reposter pubkey (drives `reposted`). */
  repostsByTarget: Record<string, Record<string, string>>;
  repostIndex: Record<string, string>;
  /** parentEventId → reply event ids (capped, includes()-dedup). */
  repliesByTarget: Record<string, string[]>;
  /** Target ids in first-touch order — FIFO eviction bookkeeping. */
  targetOrder: string[];
}

const initialState: EngagementState = {
  reactionsByTarget: {},
  reactionIndex: {},
  repostsByTarget: {},
  repostIndex: {},
  repliesByTarget: {},
  targetOrder: [],
};

export interface ReactionInput {
  targetEventId: string;
  reactor: string;
  content: string;
  eventId: string;
}
export interface RepostInput {
  targetEventId: string;
  reposter: string;
  eventId: string;
}
export interface ReplyInput {
  targetEventId: string;
  eventId: string;
}

export interface EngagementBatch {
  reactions: ReactionInput[];
  reposts: RepostInput[];
  replies: ReplyInput[];
}

function touchTarget(state: EngagementState, targetId: string): void {
  if (
    state.reactionsByTarget[targetId] ||
    state.repostsByTarget[targetId] ||
    state.repliesByTarget[targetId]
  ) {
    return;
  }
  state.targetOrder.push(targetId);
}

function evictOverCap(state: EngagementState): void {
  if (state.targetOrder.length <= TARGET_CAP) return;
  const evicted = state.targetOrder.splice(0, TARGET_EVICT_BATCH);
  for (const targetId of evicted) {
    for (const reactionId of Object.keys(state.reactionsByTarget[targetId] ?? {})) {
      delete state.reactionIndex[reactionId];
    }
    delete state.reactionsByTarget[targetId];
    for (const repostId of Object.keys(state.repostsByTarget[targetId] ?? {})) {
      delete state.repostIndex[repostId];
    }
    delete state.repostsByTarget[targetId];
    delete state.repliesByTarget[targetId];
  }
}

function applyReaction(state: EngagementState, r: ReactionInput): void {
  touchTarget(state, r.targetEventId);
  let target = state.reactionsByTarget[r.targetEventId];
  if (!target) {
    target = {};
    state.reactionsByTarget[r.targetEventId] = target;
  }
  if (!target[r.eventId] && Object.keys(target).length >= PER_TARGET_CAP) return;
  target[r.eventId] = { reactor: r.reactor, content: r.content || "+" }; // NIP-25: "" ⇒ "+"
  state.reactionIndex[r.eventId] = r.targetEventId;
}

function applyRepost(state: EngagementState, r: RepostInput): void {
  touchTarget(state, r.targetEventId);
  let target = state.repostsByTarget[r.targetEventId];
  if (!target) {
    target = {};
    state.repostsByTarget[r.targetEventId] = target;
  }
  if (!target[r.eventId] && Object.keys(target).length >= PER_TARGET_CAP) return;
  target[r.eventId] = r.reposter;
  state.repostIndex[r.eventId] = r.targetEventId;
}

function applyReply(state: EngagementState, r: ReplyInput): void {
  touchTarget(state, r.targetEventId);
  let replies = state.repliesByTarget[r.targetEventId];
  if (!replies) {
    replies = [];
    state.repliesByTarget[r.targetEventId] = replies;
  }
  if (replies.includes(r.eventId)) return;
  if (replies.length >= PER_TARGET_CAP) return;
  replies.push(r.eventId);
}

export const engagementSlice = createSlice({
  name: "engagement",
  initialState,
  reducers: {
    /** Engine 50ms-buffer flush + optimistic own-action dispatch. Every write
     *  is idempotent by event id — slice-level dedup for redeliveries that
     *  slip past the engine's bounded seen-set. */
    engagementReceived(state, action: PayloadAction<EngagementBatch>) {
      for (const r of action.payload.reactions) applyReaction(state, r);
      for (const r of action.payload.reposts) applyRepost(state, r);
      for (const r of action.payload.replies) applyReply(state, r);
      evictOverCap(state);
    },
    /** NIP-09 deletion of a reaction by its kind:7 event id. Only the
     *  original reactor may delete their own reaction. NOT wired to the
     *  engine in v1 (no kind-5 sub) — ported so deletions land later
     *  without a state migration. */
    removeReactionByEventId(
      state,
      action: PayloadAction<{ eventId: string; byPubkey: string }>,
    ) {
      const { eventId, byPubkey } = action.payload;
      const target = state.reactionIndex[eventId];
      if (target === undefined) return;
      const entry = state.reactionsByTarget[target]?.[eventId];
      if (!entry || entry.reactor !== byPubkey) return;
      delete state.reactionsByTarget[target][eventId];
      delete state.reactionIndex[eventId];
      if (Object.keys(state.reactionsByTarget[target]).length === 0) {
        delete state.reactionsByTarget[target];
      }
    },
  },
});

export const { engagementReceived, removeReactionByEventId } = engagementSlice.actions;

// --- Selectors (typed structurally to avoid a circular store import) ---
type WithEngagement = { engagement: EngagementState };

export function selectReactionCount(state: WithEngagement, targetId: string): number {
  const t = state.engagement.reactionsByTarget[targetId];
  return t ? Object.keys(t).length : 0;
}

/** The current user's reaction content on a target, else undefined — both
 *  the `liked` flag and what they reacted with. */
export function selectMyReaction(
  state: WithEngagement,
  targetId: string,
  myPubkey: string | null,
): string | undefined {
  if (!myPubkey) return undefined;
  const t = state.engagement.reactionsByTarget[targetId];
  if (!t) return undefined;
  for (const id of Object.keys(t)) {
    if (t[id].reactor === myPubkey) return t[id].content;
  }
  return undefined;
}

export function selectRepostCount(state: WithEngagement, targetId: string): number {
  const t = state.engagement.repostsByTarget[targetId];
  return t ? Object.keys(t).length : 0;
}

export function selectMyRepost(
  state: WithEngagement,
  targetId: string,
  myPubkey: string | null,
): boolean {
  if (!myPubkey) return false;
  const t = state.engagement.repostsByTarget[targetId];
  if (!t) return false;
  return Object.values(t).includes(myPubkey);
}

export function selectReplyCount(state: WithEngagement, targetId: string): number {
  return state.engagement.repliesByTarget[targetId]?.length ?? 0;
}
