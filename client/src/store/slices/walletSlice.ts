import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type WalletStatus =
  | "connecting"
  | "connected"
  | "error"
  | "disconnected";

export interface WalletEntry {
  id: string;
  label: string;
  /** The wallet service's pubkey (display only). Never the secret/URI. */
  walletPubkey: string;
  relayUrl: string;
  status: WalletStatus;
  balanceMsat: number | null;
  lastError: string | null;
}

interface ZapTotal {
  msat: number;
  count: number;
}

interface WalletState {
  /** All wallets connected for the active account, keyed by id. */
  wallets: Record<string, WalletEntry>;
  /** Pre-selection for the ZapModal picker. ZapModal also falls back to the first
   *  connected wallet if the default is missing or offline. */
  defaultWalletId: string | null;
  /** Per-event zap totals, shared across surfaces (filled by useZapTotals). */
  zapTotals: Record<string, ZapTotal>;
}

const initialState: WalletState = {
  wallets: {},
  defaultWalletId: null,
  zapTotals: {},
};

export const walletSlice = createSlice({
  name: "wallet",
  initialState,
  reducers: {
    addWalletEntry(state, action: PayloadAction<WalletEntry>) {
      state.wallets[action.payload.id] = action.payload;
    },
    updateWalletEntry(
      state,
      action: PayloadAction<{
        id: string;
        patch: Partial<Omit<WalletEntry, "id">>;
      }>,
    ) {
      const entry = state.wallets[action.payload.id];
      if (!entry) return;
      Object.assign(entry, action.payload.patch);
      // Clear stale error when transitioning out of "error"
      if (
        action.payload.patch.status &&
        action.payload.patch.status !== "error"
      ) {
        entry.lastError = null;
      }
    },
    removeWalletEntry(state, action: PayloadAction<string>) {
      delete state.wallets[action.payload];
      if (state.defaultWalletId === action.payload) {
        // Fall back to whichever wallet remains (the slice doesn't preserve
        // insertion order across mutations, so this is "any remaining"; the UI
        // can override via setDefaultWalletId).
        state.defaultWalletId = Object.keys(state.wallets)[0] ?? null;
      }
    },
    setDefaultWalletId(state, action: PayloadAction<string | null>) {
      state.defaultWalletId = action.payload;
    },
    clearWallets(state) {
      state.wallets = {};
      state.defaultWalletId = null;
    },
    setZapTotal(
      state,
      action: PayloadAction<{ eventId: string; msat: number; count: number }>,
    ) {
      state.zapTotals[action.payload.eventId] = {
        msat: action.payload.msat,
        count: action.payload.count,
      };
    },
  },
});

export const {
  addWalletEntry,
  updateWalletEntry,
  removeWalletEntry,
  setDefaultWalletId,
  clearWallets,
  setZapTotal,
} = walletSlice.actions;
