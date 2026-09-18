/**
 * NIP-57 zap receipt (kind:9735) amount extraction.
 *
 * The paid amount is NOT on the receipt itself — and the `amount` tag inside
 * the `description` (the serialized kind:9734 zap *request*, in millisats) is
 * the zapper's own self-signed claim, so it can overstate what was paid. The
 * figure a wallet actually paid against is the `bolt11` invoice, so the
 * amount is decoded from the invoice's HRP and the request's `amount` tag is
 * demoted to a cross-check: both must be present and agree (up to sub-sat
 * rounding) or the receipt contributes 0. A receipt without a `bolt11` tag
 * never settled, so it also contributes 0.
 *
 * Shared by the ingest path (per-event Redis counters), the per-space 24h
 * rollup and push notifications so all agree on what a zap is worth.
 */

const MSAT_PER_BTC = 100_000_000_000n;
/** Total bitcoin supply — no real invoice can ask for more. */
const MAX_MSAT = 21_000_000n * MSAT_PER_BTC;

/** Millisats per amount unit for each BOLT11 HRP multiplier (`p` is 0.1). */
const MULTIPLIER_MSAT: Record<string, bigint> = {
  m: 100_000_000n,
  u: 100_000n,
  n: 100n,
};

/**
 * Decode the amount from a BOLT11 invoice's human-readable part
 * (`lnbc<amount><multiplier>1…`), in millisats. Only the HRP is parsed — the
 * signed data part is not validated. Returns null for a malformed HRP, an
 * amountless invoice, or an amount no payable invoice could carry.
 */
export function decodeBolt11Msat(invoice: string): bigint | null {
  const lower = invoice.toLowerCase();
  // bech32: the data charset excludes "1", so the last "1" is the separator.
  const separator = lower.lastIndexOf("1");
  if (separator <= 0) return null;
  const hrp = lower.slice(0, separator);
  if (!hrp.startsWith("ln")) return null;
  // Longest prefix first: "bcrt"/"tbs" must not be misread as "bc"/"tb".
  const network = ["bcrt", "tbs", "tb", "bc"].find((n) => hrp.startsWith(n, 2));
  if (!network) return null;
  const amount = hrp.slice(2 + network.length);
  if (amount === "") return null; // amountless invoice — no stated amount to trust
  const match = /^([1-9]\d*)([munp])?$/.exec(amount); // leading zeros are invalid per BOLT11
  if (!match) return null;
  const units = BigInt(match[1]);
  const multiplier = match[2];
  let msat: bigint;
  if (!multiplier) msat = units * MSAT_PER_BTC;
  else if (multiplier === "p") {
    if (units % 10n !== 0n) return null; // sub-msat precision is unpayable
    msat = units / 10n;
  } else msat = units * MULTIPLIER_MSAT[multiplier];
  return msat > MAX_MSAT ? null : msat;
}

export function parseZapSats(tags: string[][]): number {
  const bolt11 = tags.find((t) => t[0] === "bolt11")?.[1];
  if (!bolt11) return 0;
  const invoiceMsat = decodeBolt11Msat(bolt11);
  if (invoiceMsat === null || invoiceMsat <= 0n) return 0;

  const description = tags.find((t) => t[0] === "description")?.[1];
  if (!description) return 0;

  let requestedMsat: bigint | null = null;
  try {
    const request = JSON.parse(description) as { tags?: string[][] };
    const amount = request.tags?.find((t) => t[0] === "amount")?.[1];
    if (typeof amount === "string" && /^[1-9]\d*$/.test(amount)) requestedMsat = BigInt(amount);
  } catch {
    return 0;
  }
  if (requestedMsat === null) return 0;

  // Tolerate sub-sat rounding (a wallet may round the requested msats to a
  // whole-sat invoice); any larger disagreement means the invoice doesn't pay
  // for what the request claims, so the receipt counts as unsettled.
  const diff =
    invoiceMsat > requestedMsat ? invoiceMsat - requestedMsat : requestedMsat - invoiceMsat;
  if (diff >= 1000n) return 0;

  return Number(invoiceMsat / 1000n);
}
