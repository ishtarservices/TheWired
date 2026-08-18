/**
 * NIP-57 zap receipt (kind:9735) amount extraction.
 *
 * The paid amount is NOT on the receipt itself — it lives in the `description`
 * tag, which carries the serialized kind:9734 zap *request*, whose `amount` tag
 * is denominated in **millisats**. A receipt without a `bolt11` tag never
 * settled, so it contributes 0.
 *
 * Shared by the ingest path (per-event Redis counters) and the per-space 24h
 * rollup so both agree on what a zap is worth.
 */
export function parseZapSats(tags: string[][]): number {
  const bolt11 = tags.find((t) => t[0] === "bolt11")?.[1];
  if (!bolt11) return 0;

  const description = tags.find((t) => t[0] === "description")?.[1];
  if (!description) return 0;

  try {
    const request = JSON.parse(description) as { tags?: string[][] };
    const amountMsats = request.tags?.find((t) => t[0] === "amount")?.[1];
    if (!amountMsats) return 0;
    const parsed = parseInt(amountMsats, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.floor(parsed / 1000);
  } catch {
    return 0;
  }
}
