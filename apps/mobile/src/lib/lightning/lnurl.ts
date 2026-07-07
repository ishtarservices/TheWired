// LNURL-pay helpers for NIP-57 zaps — mobile port of the desktop
// lib/lightning/lnurl.ts.
//
// SSRF posture: LNURL URLs derive from UNTRUSTED profile data (lud16/lud06)
// and the provider's own `callback`, so every URL is host-validated before a
// request leaves the device (https-only, no loopback/private/link-local).
// Known gap vs desktop: RN's fetch cannot disable redirect-following, so a
// malicious provider could redirect to an internal host AFTER the initial
// check. The device-network blast radius is small (we read a JSON invoice,
// pay nothing automatically from it without the amount guard), and the
// native-module HttpAdapter upgrade (guide 04) closes it properly.

import { bech32 } from "@scure/base";
import type { NostrEvent } from "@thewired/shared-types";

const PRIVATE_HOST_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|.*\.local|.*\.internal|.*\.lan|.*\.onion)$/i;

/** Validate an LNURL-derived URL: https to a public host, or throw. */
export function assertSafeLnurlUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid Lightning address URL.");
  }
  if (url.protocol !== "https:") {
    throw new Error("Lightning providers must use https.");
  }
  if (!url.hostname || PRIVATE_HOST_RE.test(url.hostname)) {
    throw new Error("Refusing to contact a private-network Lightning URL.");
  }
  return url.toString();
}

export interface ZapEndpoint {
  callback: string;
  /** Bounds are in millisats. */
  minSendable: number;
  maxSendable: number;
  nostrPubkey?: string;
  /** True only when the endpoint advertises Nostr zaps with a valid nostrPubkey. */
  allowsNostr: boolean;
  commentAllowed: number;
  /** bech32-encoded LNURL for the zap request `lnurl` tag + callback param. */
  lnurlBech32: string;
}

/** bech32-encode an LNURL-pay URL (uppercase, per the LNURL convention). */
export function encodeLnurl(url: string): string {
  const words = bech32.toWords(new TextEncoder().encode(url));
  return bech32.encode("lnurl", words, false).toUpperCase();
}

/** Decode a bech32 `lnurl1...` string back to its URL. */
export function decodeLnurl(lnurl: string): string {
  const { words } = bech32.decode(lnurl.toLowerCase() as `lnurl1${string}`, false);
  return new TextDecoder().decode(bech32.fromWords(words));
}

/** Convert a lud16 (`name@domain`) to its LNURL-pay GET URL. */
export function lud16ToUrl(lud16: string): string | null {
  const at = lud16.indexOf("@");
  if (at <= 0) return null;
  const name = lud16.slice(0, at).trim();
  const domain = lud16.slice(at + 1).trim();
  if (!name || !domain) return null;
  // .onion needs http + Tor — out of reach on mobile; the guard rejects it.
  return `https://${domain}/.well-known/lnurlp/${name}`;
}

async function lnurlFetch(rawUrl: string): Promise<Response> {
  const url = assertSafeLnurlUrl(rawUrl);
  return fetch(url);
}

/**
 * Resolve a recipient's LNURL-pay endpoint. Accepts a lud16 (`name@domain`),
 * a bech32 `lnurl1...`, or a raw https URL (lud06 / a `zap` tag value).
 */
export async function resolveZapEndpoint(opts: {
  lud16?: string;
  lnurl?: string;
}): Promise<ZapEndpoint> {
  let url: string | null = null;
  let lnurlBech32 = "";

  if (opts.lud16) {
    url = lud16ToUrl(opts.lud16);
    if (url) lnurlBech32 = encodeLnurl(url);
  } else if (opts.lnurl) {
    const raw = opts.lnurl.trim();
    if (raw.toLowerCase().startsWith("lnurl")) {
      url = decodeLnurl(raw);
      lnurlBech32 = raw.toUpperCase();
    } else if (raw.startsWith("http")) {
      url = raw;
      lnurlBech32 = encodeLnurl(raw);
    }
  }

  if (!url) throw new Error("This user has no Lightning address.");

  const res = await lnurlFetch(url);
  if (!res.ok) throw new Error("Couldn't reach the recipient's Lightning provider.");
  const data = (await res.json()) as Record<string, unknown>;

  if (data.tag !== "payRequest" || typeof data.callback !== "string") {
    throw new Error("Invalid LNURL-pay response.");
  }

  const nostrPubkey =
    typeof data.nostrPubkey === "string" && /^[0-9a-f]{64}$/i.test(data.nostrPubkey)
      ? data.nostrPubkey.toLowerCase()
      : undefined;

  return {
    // The callback is server-supplied — validate it NOW so a poisoned value
    // fails at resolve time, not mid-payment.
    callback: assertSafeLnurlUrl(data.callback),
    minSendable: Number(data.minSendable) || 0,
    maxSendable: Number(data.maxSendable) || 0,
    nostrPubkey,
    allowsNostr: data.allowsNostr === true && !!nostrPubkey,
    commentAllowed: Number(data.commentAllowed) || 0,
    lnurlBech32,
  };
}

function appendParam(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${value}`;
}

async function fetchInvoice(url: string): Promise<string> {
  const res = await lnurlFetch(url);
  if (!res.ok) throw new Error("Lightning provider rejected the request.");
  const data = (await res.json()) as { pr?: string; status?: string; reason?: string };
  if (data.status === "ERROR" || !data.pr) {
    throw new Error(data.reason || "No invoice returned by the Lightning provider.");
  }
  return data.pr;
}

/** Request a BOLT11 invoice from the LNURL callback for a signed zap request. */
export async function requestZapInvoice(opts: {
  callback: string;
  amountMsat: number;
  zapRequest: NostrEvent;
  lnurlBech32: string;
}): Promise<string> {
  let url = appendParam(opts.callback, "amount", String(opts.amountMsat));
  url = appendParam(url, "nostr", encodeURIComponent(JSON.stringify(opts.zapRequest)));
  if (opts.lnurlBech32) url = appendParam(url, "lnurl", opts.lnurlBech32);
  return fetchInvoice(url);
}

/** Request a plain (non-zap) LNURL invoice — for recipients without Nostr support. */
export async function requestPlainInvoice(
  callback: string,
  amountMsat: number,
): Promise<string> {
  return fetchInvoice(appendParam(callback, "amount", String(amountMsat)));
}
