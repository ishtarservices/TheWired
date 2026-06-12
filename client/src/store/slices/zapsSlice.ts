import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/**
 * Aggregate of NIP-57 zap receipts (kind:9735), keyed by the zapped event id so
 * re-delivery dedups and we never keep the full receipt event. Per receipt we
 * keep just the amount + (best-effort) zapper identity and comment, parsed from
 * the embedded kind:9734 request in the receipt's `description` tag.
 *
 * Receipts are public and client-agnostic: a zap sent from ANY Nostr client
 * lands here as long as its receipt reaches a relay we query.
 *
 * NOTE: the embedded zapper pubkey/comment are signed by the zapper, but we
 * don't re-verify that signature here (display-only, like other clients). The
 * comment is always rendered as plain text — never markup.
 */
export interface ZapReceiptEntry {
  msat: number;
  /** Zapper pubkey from the embedded request; null for anonymous / non-nostr zaps. */
  zapper: string | null;
  /** Zap comment (may be empty). */
  comment: string;
  /** Receipt created_at (unix seconds) — used to surface the most recent comment. */
  createdAt: number;
}

interface ZapsState {
  /** targetEventId → receiptEventId(9735) → entry */
  byTarget: Record<string, Record<string, ZapReceiptEntry>>;
}

const initialState: ZapsState = { byTarget: {} };

export interface ZapInput extends ZapReceiptEntry {
  targetEventId: string;
  /** The kind:9735 receipt's event id — the dedup key. */
  receiptId: string;
}

function applyZap(state: ZapsState, z: ZapInput): void {
  let target = state.byTarget[z.targetEventId];
  if (!target) {
    target = {};
    state.byTarget[z.targetEventId] = target;
  }
  target[z.receiptId] = {
    msat: z.msat,
    zapper: z.zapper,
    comment: z.comment,
    createdAt: z.createdAt,
  };
}

export const zapsSlice = createSlice({
  name: "zaps",
  initialState,
  reducers: {
    addZap(state, action: PayloadAction<ZapInput>) {
      applyZap(state, action.payload);
    },
    /** Batched variant used by the eventPipeline burst flush. */
    addZaps(state, action: PayloadAction<ZapInput[]>) {
      for (const z of action.payload) applyZap(state, z);
    },
  },
});

export const { addZap, addZaps } = zapsSlice.actions;

// --- Selectors / pure aggregation (typed structurally to avoid a store import) ---
type WithZaps = { zaps: ZapsState };
type ReceiptMap = Record<string, ZapReceiptEntry>;

/** The raw receipt map for a target (stable reference unless its zaps change —
 *  memoize derived shapes off this, like the reaction aggregate does). */
export function selectZapMap(
  state: WithZaps,
  targetId: string,
): ReceiptMap | undefined {
  return state.zaps.byTarget[targetId];
}

/** Number of zap receipts on a target event. */
export function selectZapCount(state: WithZaps, targetId: string): number {
  const t = state.zaps.byTarget[targetId];
  return t ? Object.keys(t).length : 0;
}

/** Total zapped amount on a target event, in millisats. */
export function selectZapMsat(state: WithZaps, targetId: string): number {
  const t = state.zaps.byTarget[targetId];
  if (!t) return 0;
  let msat = 0;
  for (const id in t) msat += t[id].msat;
  return msat;
}

export interface ZapAggregate {
  count: number;
  msat: number;
  sats: number;
  /** Most recent receipt carrying a non-empty comment, else null. */
  recent: ZapReceiptEntry | null;
}

/** Pure summary for the inline chip. Memoize against `selectZapMap`'s reference. */
export function aggregateZaps(map: ReceiptMap | undefined): ZapAggregate {
  if (!map) return { count: 0, msat: 0, sats: 0, recent: null };
  let msat = 0;
  let recent: ZapReceiptEntry | null = null;
  let count = 0;
  for (const id in map) {
    const e = map[id];
    count += 1;
    msat += e.msat;
    if (e.comment.trim() && (!recent || e.createdAt > recent.createdAt)) {
      recent = e;
    }
  }
  return { count, msat, sats: Math.floor(msat / 1000), recent };
}

/** Receipts sorted for the list view: largest amount first, newest as tiebreak. */
export function sortedZapEntries(map: ReceiptMap | undefined): ZapReceiptEntry[] {
  if (!map) return [];
  return Object.values(map).sort(
    (a, b) => b.msat - a.msat || b.createdAt - a.createdAt,
  );
}
