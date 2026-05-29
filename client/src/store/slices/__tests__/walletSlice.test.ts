import { describe, it, expect } from "vitest";
import {
  walletSlice,
  addWalletEntry,
  updateWalletEntry,
  removeWalletEntry,
  setDefaultWalletId,
  clearWallets,
  setZapTotal,
  type WalletEntry,
} from "../walletSlice";

const reducer = walletSlice.reducer;

function entry(over: Partial<WalletEntry> = {}): WalletEntry {
  return {
    id: "w1",
    label: "Alby Hub",
    walletPubkey: "abc",
    relayUrl: "wss://relay.example",
    status: "connected",
    balanceMsat: 100_000,
    lastError: null,
    ...over,
  };
}

describe("walletSlice", () => {
  it("starts empty", () => {
    const state = reducer(undefined, { type: "@@INIT" });
    expect(state.wallets).toEqual({});
    expect(state.defaultWalletId).toBeNull();
    expect(state.zapTotals).toEqual({});
  });

  it("addWalletEntry stores by id", () => {
    const s = reducer(undefined, addWalletEntry(entry()));
    expect(s.wallets["w1"].label).toBe("Alby Hub");
  });

  it("addWalletEntry with the same id overwrites (re-add path)", () => {
    let s = reducer(undefined, addWalletEntry(entry()));
    s = reducer(s, addWalletEntry(entry({ label: "Renamed", balanceMsat: 42 })));
    expect(s.wallets["w1"].label).toBe("Renamed");
    expect(s.wallets["w1"].balanceMsat).toBe(42);
  });

  it("updateWalletEntry merges a patch and preserves other fields", () => {
    let s = reducer(undefined, addWalletEntry(entry()));
    s = reducer(
      s,
      updateWalletEntry({ id: "w1", patch: { balanceMsat: 250_000 } }),
    );
    expect(s.wallets["w1"].balanceMsat).toBe(250_000);
    expect(s.wallets["w1"].label).toBe("Alby Hub");
    expect(s.wallets["w1"].status).toBe("connected");
  });

  it("updateWalletEntry clears lastError when leaving error state", () => {
    let s = reducer(
      undefined,
      addWalletEntry(entry({ status: "error", lastError: "offline" })),
    );
    s = reducer(
      s,
      updateWalletEntry({
        id: "w1",
        patch: { status: "connected", balanceMsat: 99 },
      }),
    );
    expect(s.wallets["w1"].lastError).toBeNull();
    expect(s.wallets["w1"].status).toBe("connected");
  });

  it("updateWalletEntry preserves lastError when patch has no status", () => {
    let s = reducer(
      undefined,
      addWalletEntry(entry({ status: "error", lastError: "offline" })),
    );
    s = reducer(s, updateWalletEntry({ id: "w1", patch: { balanceMsat: 7 } }));
    expect(s.wallets["w1"].lastError).toBe("offline");
    expect(s.wallets["w1"].balanceMsat).toBe(7);
  });

  it("updateWalletEntry no-ops for an unknown id", () => {
    const s0 = reducer(undefined, addWalletEntry(entry()));
    const s1 = reducer(
      s0,
      updateWalletEntry({ id: "missing", patch: { label: "x" } }),
    );
    expect(s1).toEqual(s0);
  });

  it("removeWalletEntry deletes the entry", () => {
    let s = reducer(undefined, addWalletEntry(entry()));
    s = reducer(s, removeWalletEntry("w1"));
    expect(s.wallets["w1"]).toBeUndefined();
  });

  it("removeWalletEntry promotes another wallet when removing the default", () => {
    let s = reducer(undefined, addWalletEntry(entry({ id: "w1" })));
    s = reducer(s, addWalletEntry(entry({ id: "w2", label: "Coinos" })));
    s = reducer(s, setDefaultWalletId("w1"));
    s = reducer(s, removeWalletEntry("w1"));
    expect(s.defaultWalletId).toBe("w2");
  });

  it("removeWalletEntry clears default when no wallets remain", () => {
    let s = reducer(undefined, addWalletEntry(entry()));
    s = reducer(s, setDefaultWalletId("w1"));
    s = reducer(s, removeWalletEntry("w1"));
    expect(s.defaultWalletId).toBeNull();
  });

  it("removeWalletEntry leaves default untouched when removing a non-default", () => {
    let s = reducer(undefined, addWalletEntry(entry({ id: "w1" })));
    s = reducer(s, addWalletEntry(entry({ id: "w2", label: "Coinos" })));
    s = reducer(s, setDefaultWalletId("w1"));
    s = reducer(s, removeWalletEntry("w2"));
    expect(s.defaultWalletId).toBe("w1");
  });

  it("clearWallets drops every wallet and the default", () => {
    let s = reducer(undefined, addWalletEntry(entry()));
    s = reducer(s, setDefaultWalletId("w1"));
    s = reducer(s, clearWallets());
    expect(s.wallets).toEqual({});
    expect(s.defaultWalletId).toBeNull();
  });

  it("clearWallets preserves zap totals (per-event, not per-wallet)", () => {
    let s = reducer(
      undefined,
      setZapTotal({ eventId: "e1", msat: 1000, count: 1 }),
    );
    s = reducer(s, addWalletEntry(entry()));
    s = reducer(s, clearWallets());
    expect(s.zapTotals["e1"]).toEqual({ msat: 1000, count: 1 });
  });

  it("setZapTotal stores per-event totals (overwrite on repeat)", () => {
    let s = reducer(
      undefined,
      setZapTotal({ eventId: "e1", msat: 1000, count: 1 }),
    );
    s = reducer(s, setZapTotal({ eventId: "e1", msat: 2000, count: 2 }));
    s = reducer(s, setZapTotal({ eventId: "e2", msat: 500, count: 1 }));
    expect(s.zapTotals["e1"]).toEqual({ msat: 2000, count: 2 });
    expect(s.zapTotals["e2"]).toEqual({ msat: 500, count: 1 });
  });
});
