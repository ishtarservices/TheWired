import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** A reaction's reactor + content, keyed by its kind:7 event id. */
interface ReactionEntry {
  reactor: string;
  content: string;
}

interface ReactionsState {
  /** targetEventId → reactionEventId → {reactor, content}. Keyed by event id so
   *  re-delivery dedups and a user may hold multiple distinct reactions (chat
   *  multi-emoji). Replaces storing full kind:7 events in the entity adapter —
   *  ~70 bytes/reaction vs a full signed event, and the sorted adapter stays lean. */
  byTarget: Record<string, Record<string, ReactionEntry>>;
  /** reactionEventId → targetEventId, so a kind:5 deletion (which references the
   *  reaction by id) can find and remove it without us keeping the full event. */
  byEventId: Record<string, string>;
}

const initialState: ReactionsState = { byTarget: {}, byEventId: {} };

export interface ReactionInput {
  targetEventId: string;
  reactor: string;
  content: string;
  eventId: string;
}

function applyReaction(state: ReactionsState, r: ReactionInput): void {
  let target = state.byTarget[r.targetEventId];
  if (!target) {
    target = {};
    state.byTarget[r.targetEventId] = target;
  }
  target[r.eventId] = { reactor: r.reactor, content: r.content || "+" }; // NIP-25: "" ⇒ "+"
  state.byEventId[r.eventId] = r.targetEventId;
}

export const reactionsSlice = createSlice({
  name: "reactions",
  initialState,
  reducers: {
    addReaction(state, action: PayloadAction<ReactionInput>) {
      applyReaction(state, action.payload);
    },
    /** Batched variant used by the eventPipeline burst flush. */
    addReactions(state, action: PayloadAction<ReactionInput[]>) {
      for (const r of action.payload) applyReaction(state, r);
    },
    /** Remove a reaction referenced by its kind:7 event id (NIP-09 deletion).
     *  Only the original reactor may delete their own reaction. */
    removeReactionByEventId(
      state,
      action: PayloadAction<{ eventId: string; byPubkey: string }>,
    ) {
      const { eventId, byPubkey } = action.payload;
      const target = state.byEventId[eventId];
      if (target === undefined) return;
      const entry = state.byTarget[target]?.[eventId];
      if (!entry || entry.reactor !== byPubkey) return;
      delete state.byTarget[target][eventId];
      delete state.byEventId[eventId];
      if (Object.keys(state.byTarget[target]).length === 0) {
        delete state.byTarget[target];
      }
    },
  },
});

export const { addReaction, addReactions, removeReactionByEventId } =
  reactionsSlice.actions;

// --- Selectors (typed structurally to avoid a circular store import) ---
type WithReactions = { reactions: ReactionsState };

/** Total reactions on a target event (matches the legacy event-count semantics). */
export function selectReactionCount(state: WithReactions, targetId: string): number {
  const t = state.reactions.byTarget[targetId];
  return t ? Object.keys(t).length : 0;
}

/** The current user's reaction content on a target (one of them), else undefined.
 *  Used both for the "liked" flag and to know what the user reacted with. */
export function selectMyReaction(
  state: WithReactions,
  targetId: string,
  myPubkey: string | null,
): string | undefined {
  if (!myPubkey) return undefined;
  const t = state.reactions.byTarget[targetId];
  if (!t) return undefined;
  for (const id of Object.keys(t)) {
    if (t[id].reactor === myPubkey) return t[id].content;
  }
  return undefined;
}

/** Group a target's reactions into emoji-pill counts. Pure helper so a component
 *  can subscribe to the (stable) map reference and memoize the grouping. */
export function aggregateReactions(
  map: Record<string, ReactionEntry> | undefined,
): { content: string; count: number }[] {
  if (!map) return [];
  const grouped: Record<string, number> = {};
  for (const id of Object.keys(map)) {
    const c = map[id].content;
    grouped[c] = (grouped[c] ?? 0) + 1;
  }
  return Object.entries(grouped).map(([content, count]) => ({ content, count }));
}

export function selectReactionAggregate(
  state: WithReactions,
  targetId: string,
): { content: string; count: number }[] {
  return aggregateReactions(state.reactions.byTarget[targetId]);
}
