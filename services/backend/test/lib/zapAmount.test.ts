import { describe, it, expect } from "vitest";
import { parseZapSats } from "../../src/lib/nostr/zapAmount.js";

/** Build a kind:9735 receipt's tag set for a zap of `sats`. */
function receiptTags(sats: number, overrides: { bolt11?: boolean } = {}): string[][] {
  const tags: string[][] = [["e", "a".repeat(64)]];
  if (overrides.bolt11 !== false) tags.push(["bolt11", "lnbc1..."]);
  tags.push([
    "description",
    JSON.stringify({ kind: 9734, tags: [["amount", String(sats * 1000)]] }),
  ]);
  return tags;
}

describe("parseZapSats", () => {
  it("converts the zap request's millisat amount to sats", () => {
    expect(parseZapSats(receiptTags(21))).toBe(21);
    expect(parseZapSats(receiptTags(5000))).toBe(5000);
  });

  it("floors sub-sat amounts rather than returning a fraction", () => {
    const tags = [
      ["bolt11", "lnbc1..."],
      ["description", JSON.stringify({ kind: 9734, tags: [["amount", "1500"]] })],
    ];
    expect(parseZapSats(tags)).toBe(1);
  });

  it("returns 0 for a receipt with no bolt11 — it never settled", () => {
    expect(parseZapSats(receiptTags(1000, { bolt11: false }))).toBe(0);
  });

  it("returns 0 when the description is missing or unparseable", () => {
    expect(parseZapSats([["bolt11", "lnbc1..."]])).toBe(0);
    expect(parseZapSats([["bolt11", "lnbc1..."], ["description", "{not json"]])).toBe(0);
  });

  it("returns 0 when the zap request carries no amount tag", () => {
    const tags = [
      ["bolt11", "lnbc1..."],
      ["description", JSON.stringify({ kind: 9734, tags: [["p", "b".repeat(64)]] })],
    ];
    expect(parseZapSats(tags)).toBe(0);
  });

  it("rejects non-numeric and non-positive amounts instead of yielding NaN", () => {
    for (const amount of ["abc", "-5000", "0"]) {
      const tags = [
        ["bolt11", "lnbc1..."],
        ["description", JSON.stringify({ kind: 9734, tags: [["amount", amount]] })],
      ];
      expect(parseZapSats(tags)).toBe(0);
    }
  });

  it("handles an empty tag list", () => {
    expect(parseZapSats([])).toBe(0);
  });
});
