import { describe, it, expect } from "vitest";
import { decodeBolt11Msat, parseZapSats } from "../../src/lib/nostr/zapAmount.js";
import { invoiceForMsat, invoiceForSats } from "../helpers/bolt11.js";

/** Build a kind:9735 receipt's tag set for a zap of `sats`. */
function receiptTags(
  sats: number,
  overrides: { bolt11?: string | false; amount?: string | false } = {},
): string[][] {
  const tags: string[][] = [["e", "a".repeat(64)]];
  if (overrides.bolt11 !== false) tags.push(["bolt11", overrides.bolt11 ?? invoiceForSats(sats)]);
  const amount = overrides.amount === false ? null : (overrides.amount ?? String(sats * 1000));
  tags.push([
    "description",
    JSON.stringify({ kind: 9734, tags: amount === null ? [["p", "b".repeat(64)]] : [["amount", amount]] }),
  ]);
  return tags;
}

describe("decodeBolt11Msat", () => {
  it("decodes each HRP multiplier to millisats", () => {
    expect(decodeBolt11Msat("lnbc25m1pn0s3ttqqpp5")).toBe(2_500_000_000n);
    expect(decodeBolt11Msat("lnbc2500u1pn0s3ttqqpp5")).toBe(250_000_000n);
    expect(decodeBolt11Msat("lnbc210n1pn0s3ttqqpp5")).toBe(21_000n);
    expect(decodeBolt11Msat("lnbc9678785340p1pn0s3ttqqpp5")).toBe(967_878_534n);
    expect(decodeBolt11Msat("lnbc21pn0s3ttqqpp5")).toBe(2n * 100_000_000_000n); // "2" BTC, no multiplier
  });

  it("is case-insensitive and accepts non-mainnet prefixes", () => {
    expect(decodeBolt11Msat("LNBC210N1PN0S3TTQQPP5")).toBe(21_000n);
    expect(decodeBolt11Msat("lntb210n1pn0s3ttqqpp5")).toBe(21_000n);
    expect(decodeBolt11Msat("lntbs210n1pn0s3ttqqpp5")).toBe(21_000n);
    expect(decodeBolt11Msat("lnbcrt210n1pn0s3ttqqpp5")).toBe(21_000n);
  });

  it("returns null for amountless invoices — the old placeholder shape decodes to nothing", () => {
    expect(decodeBolt11Msat("lnbc...")).toBeNull();
    expect(decodeBolt11Msat("lnbc1pn0s3ttqqpp5")).toBeNull();
  });

  it("returns null for malformed HRPs, sub-msat precision and leading zeros", () => {
    expect(decodeBolt11Msat("")).toBeNull();
    expect(decodeBolt11Msat("x")).toBeNull();
    expect(decodeBolt11Msat("lnbc-dev-seed")).toBeNull();
    expect(decodeBolt11Msat("bc210n1pn0s3tt")).toBeNull(); // not lightning
    expect(decodeBolt11Msat("lnxx210n1pn0s3tt")).toBeNull(); // unknown network
    expect(decodeBolt11Msat("lnbc21x1pn0s3tt")).toBeNull(); // unknown multiplier
    expect(decodeBolt11Msat("lnbc15p1pn0s3tt")).toBeNull(); // 1.5 msat is unpayable
    expect(decodeBolt11Msat("lnbc0210n1pn0s3tt")).toBeNull(); // leading zero
  });

  it("returns null for amounts beyond the total bitcoin supply", () => {
    expect(decodeBolt11Msat("lnbc22000000" + "1pn0s3ttqqpp5")).toBeNull(); // 22M BTC
    expect(decodeBolt11Msat("lnbc21000000" + "1pn0s3ttqqpp5")).toBe(21_000_000n * 100_000_000_000n);
  });
});

describe("parseZapSats", () => {
  it("returns the bolt11-decoded amount when it matches the request's amount tag", () => {
    expect(parseZapSats(receiptTags(21))).toBe(21);
    expect(parseZapSats(receiptTags(5000))).toBe(5000);
  });

  it("floors sub-sat amounts rather than returning a fraction", () => {
    expect(parseZapSats(receiptTags(0, { bolt11: invoiceForMsat(1500), amount: "1500" }))).toBe(1);
  });

  it("returns 0 when the request overstates what the invoice pays — the self-signed inflation attack", () => {
    // Claims 50M sats, invoice is for 21 sats.
    const tags = receiptTags(21, { amount: "50000000000" });
    expect(parseZapSats(tags)).toBe(0);
  });

  it("returns 0 when the invoice pays more than the request claims", () => {
    expect(parseZapSats(receiptTags(5000, { amount: "21000" }))).toBe(0);
  });

  it("tolerates sub-sat rounding between request and invoice", () => {
    // Request 21.5 sats, wallet rounded the invoice down to 21 sats even.
    const tags = receiptTags(21, { amount: "21500" });
    expect(parseZapSats(tags)).toBe(21);
  });

  it("returns 0 for a receipt with no bolt11 — it never settled", () => {
    expect(parseZapSats(receiptTags(1000, { bolt11: false }))).toBe(0);
  });

  it("returns 0 for an undecodable or amountless bolt11, whatever the request claims", () => {
    expect(parseZapSats(receiptTags(21, { bolt11: "lnbc..." }))).toBe(0);
    expect(parseZapSats(receiptTags(21, { bolt11: "not-an-invoice" }))).toBe(0);
  });

  it("returns 0 when the description is missing or unparseable", () => {
    expect(parseZapSats([["bolt11", invoiceForSats(21)]])).toBe(0);
    expect(parseZapSats([["bolt11", invoiceForSats(21)], ["description", "{not json"]])).toBe(0);
  });

  it("returns 0 when the zap request carries no amount tag to cross-check", () => {
    expect(parseZapSats(receiptTags(21, { amount: false }))).toBe(0);
  });

  it("rejects non-numeric and non-positive request amounts instead of yielding NaN", () => {
    for (const amount of ["abc", "-5000", "0", "21e3", "21000.5"]) {
      expect(parseZapSats(receiptTags(21, { amount }))).toBe(0);
    }
  });

  it("handles an empty tag list", () => {
    expect(parseZapSats([])).toBe(0);
  });
});
