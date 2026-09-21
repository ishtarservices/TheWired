/**
 * Real-shaped BOLT11 invoices for tests: the HRP (`lnbc<amount><multiplier>`)
 * encodes the amount exactly the way parseZapSats decodes it; the data part
 * after the separator is fake (never validated, must not contain "1").
 */

export function invoiceForMsat(msat: number): string {
  const hrp =
    msat % 100_000 === 0
      ? `lnbc${msat / 100_000}u`
      : msat % 100 === 0
        ? `lnbc${msat / 100}n`
        : `lnbc${msat * 10}p`;
  return `${hrp}1pn0s3ttqqpp5faked4tap4rt`;
}

export function invoiceForSats(sats: number): string {
  return invoiceForMsat(sats * 1000);
}
