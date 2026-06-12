import { describe, it, expect } from "vitest";
import {
  zapsSlice,
  addZap,
  addZaps,
  selectZapCount,
  selectZapMsat,
  selectZapMap,
  aggregateZaps,
  sortedZapEntries,
  type ZapInput,
} from "../zapsSlice";

const reduce = zapsSlice.reducer;
const NOTE = "n".repeat(64);
const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

function zap(partial: Partial<ZapInput> & Pick<ZapInput, "receiptId" | "msat">): ZapInput {
  return {
    targetEventId: NOTE,
    zapper: null,
    comment: "",
    createdAt: 0,
    ...partial,
  };
}

describe("zapsSlice", () => {
  it("sums amounts and counts receipts for a target", () => {
    let state = reduce(undefined, { type: "@@init" });
    state = reduce(state, addZap(zap({ receiptId: "r1", msat: 21_000 })));
    state = reduce(state, addZap(zap({ receiptId: "r2", msat: 100_000 })));

    expect(selectZapCount({ zaps: state }, NOTE)).toBe(2);
    expect(selectZapMsat({ zaps: state }, NOTE)).toBe(121_000);
  });

  it("dedups re-delivered receipts by receipt id (idempotent)", () => {
    let state = reduce(undefined, { type: "@@init" });
    state = reduce(state, addZap(zap({ receiptId: "r1", msat: 21_000 })));
    state = reduce(state, addZap(zap({ receiptId: "r1", msat: 21_000 })));

    expect(selectZapCount({ zaps: state }, NOTE)).toBe(1);
    expect(selectZapMsat({ zaps: state }, NOTE)).toBe(21_000);
  });

  it("aggregateZaps surfaces the most recent commented zap", () => {
    let state = reduce(undefined, { type: "@@init" });
    state = reduce(state, addZap(zap({ receiptId: "r1", msat: 5_000, zapper: ALICE, comment: "old", createdAt: 100 })));
    state = reduce(state, addZap(zap({ receiptId: "r2", msat: 5_000, zapper: BOB, comment: "newest", createdAt: 200 })));
    // A later receipt with no comment must not override the recent comment.
    state = reduce(state, addZap(zap({ receiptId: "r3", msat: 9_000, zapper: ALICE, comment: "", createdAt: 300 })));

    const agg = aggregateZaps(selectZapMap({ zaps: state }, NOTE));
    expect(agg.count).toBe(3);
    expect(agg.sats).toBe(19); // floor(19000/1000)
    expect(agg.recent?.comment).toBe("newest");
  });

  it("aggregateZaps returns an empty summary for an unzapped target", () => {
    const state = reduce(undefined, { type: "@@init" });
    const agg = aggregateZaps(selectZapMap({ zaps: state }, "missing"));
    expect(agg).toEqual({ count: 0, msat: 0, sats: 0, recent: null });
  });

  it("sortedZapEntries orders by amount desc", () => {
    const state = reduce(
      undefined,
      addZaps([
        zap({ receiptId: "r1", msat: 5_000, zapper: ALICE }),
        zap({ receiptId: "r2", msat: 50_000, zapper: BOB }),
      ]),
    );
    const list = sortedZapEntries(selectZapMap({ zaps: state }, NOTE));
    expect(list.map((e) => e.msat)).toEqual([50_000, 5_000]);
  });
});
