// kind-9735 zap receipts folded into per-event aggregates (desktop
// zapsSlice pattern: receipts are never stored as full events — only the
// running total). Receipts arrive via NoteThread one-shot fetches and any
// live sub that happens to carry them.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface ZapAggregate {
  msat: number;
  count: number;
}

interface ZapsState {
  /** target event id → aggregate. */
  byEvent: Record<string, ZapAggregate>;
  /** receipt ids already folded (bounded). */
  seenReceipts: string[];
  seenReceiptSet: Record<string, true>;
}

const initialState: ZapsState = {
  byEvent: {},
  seenReceipts: [],
  seenReceiptSet: {},
};

export const zapsSlice = createSlice({
  name: "zaps",
  initialState,
  reducers: {
    zapReceiptSeen(
      state,
      action: PayloadAction<{ receiptId: string; targetEventId: string; msat: number }>,
    ) {
      const { receiptId, targetEventId, msat } = action.payload;
      if (state.seenReceiptSet[receiptId]) return;
      state.seenReceipts.push(receiptId);
      state.seenReceiptSet[receiptId] = true;
      if (state.seenReceipts.length > 2000) {
        const evicted = state.seenReceipts.splice(0, 1000);
        for (const id of evicted) delete state.seenReceiptSet[id];
      }
      const agg = (state.byEvent[targetEventId] ??= { msat: 0, count: 0 });
      agg.msat += msat;
      agg.count += 1;
    },
  },
});

export const { zapReceiptSeen } = zapsSlice.actions;
