import { zapsSlice, zapReceiptSeen } from "../slices/zapsSlice";

const reduce = zapsSlice.reducer;

describe("zapsSlice", () => {
  it("folds receipts into per-event totals", () => {
    let state = reduce(undefined, zapReceiptSeen({ receiptId: "r1", targetEventId: "e1", msat: 21_000 }));
    state = reduce(state, zapReceiptSeen({ receiptId: "r2", targetEventId: "e1", msat: 100_000 }));
    state = reduce(state, zapReceiptSeen({ receiptId: "r3", targetEventId: "e2", msat: 500_000 }));
    expect(state.byEvent.e1).toEqual({ msat: 121_000, count: 2 });
    expect(state.byEvent.e2).toEqual({ msat: 500_000, count: 1 });
  });

  it("ignores duplicate receipt ids (relay echoes)", () => {
    let state = reduce(undefined, zapReceiptSeen({ receiptId: "r1", targetEventId: "e1", msat: 21_000 }));
    state = reduce(state, zapReceiptSeen({ receiptId: "r1", targetEventId: "e1", msat: 21_000 }));
    expect(state.byEvent.e1).toEqual({ msat: 21_000, count: 1 });
  });
});
