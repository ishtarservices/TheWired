/**
 * LNURL-pay helpers for NIP-57 zaps.
 *
 * Transport: on desktop (Tauri) we use the native HTTP plugin, which bypasses browser
 * CORS — LNURL endpoints live on arbitrary lightning-address domains. On web we use the
 * browser `fetch` (a gateway proxy fallback is a future addition; see PACKAGES_DESIGN.md).
 */
import { bech32 } from "@scure/base";
import type { NostrEvent } from "../../types/nostr";
import { createLogger } from "../debug/logger";

const lnurlLog = createLogger("lnurl");

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function lnurlFetch(url: string): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url);
  }
  return fetch(url);
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
  const { words } = bech32.decode(
    lnurl.toLowerCase() as `lnurl1${string}`,
    false,
  );
  return new TextDecoder().decode(bech32.fromWords(words));
}

/** Convert a lud16 (`name@domain`) to its LNURL-pay GET URL. */
export function lud16ToUrl(lud16: string): string | null {
  const at = lud16.indexOf("@");
  if (at <= 0) return null;
  const name = lud16.slice(0, at).trim();
  const domain = lud16.slice(at + 1).trim();
  if (!name || !domain) return null;
  const scheme = domain.endsWith(".onion") ? "http" : "https";
  return `${scheme}://${domain}/.well-known/lnurlp/${name}`;
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

  lnurlLog.info("resolve", { url });
  const res = await lnurlFetch(url);
  if (!res.ok) {
    lnurlLog.warn("resolve failed", { url, status: res.status });
    throw new Error("Couldn't reach the recipient's Lightning provider.");
  }
  const data = (await res.json()) as Record<string, unknown>;
  lnurlLog.info("resolved", {
    url,
    tag: data.tag,
    callback: data.callback,
    allowsNostr: data.allowsNostr,
    nostrPubkey: data.nostrPubkey,
    minSendable: data.minSendable,
    maxSendable: data.maxSendable,
  });

  if (data.tag !== "payRequest" || typeof data.callback !== "string") {
    throw new Error("Invalid LNURL-pay response.");
  }

  const nostrPubkey =
    typeof data.nostrPubkey === "string" &&
    /^[0-9a-f]{64}$/i.test(data.nostrPubkey)
      ? data.nostrPubkey.toLowerCase()
      : undefined;

  return {
    callback: data.callback,
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
  lnurlLog.info("invoice request", { url });
  const res = await lnurlFetch(url);
  if (!res.ok) {
    lnurlLog.warn("invoice request failed", { url, status: res.status });
    throw new Error("Lightning provider rejected the request.");
  }
  const data = (await res.json()) as {
    pr?: string;
    status?: string;
    reason?: string;
  };
  if (data.status === "ERROR" || !data.pr) {
    lnurlLog.warn("invoice error response", {
      url,
      status: data.status,
      reason: data.reason,
    });
    throw new Error(data.reason || "No invoice returned by the Lightning provider.");
  }
  lnurlLog.info("invoice ok", { url, prLen: data.pr.length });
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
