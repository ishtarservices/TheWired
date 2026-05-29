/**
 * NIP-57 zap orchestration: build + sign a kind:9734 zap request, fetch the BOLT11
 * invoice from the recipient's LNURL callback, pay it (via the caller's wallet), and
 * validate/aggregate kind:9735 receipts.
 *
 * Amounts are handled internally in **millisats**; the UI works in sats (× 1000).
 */
import { makeZapRequest, getSatoshisAmountFromBolt11 } from "nostr-tools/nip57";
import {
  generateSecretKey,
  finalizeEvent,
  type Event as NostrToolsEvent,
} from "nostr-tools/pure";
import type { NostrEvent } from "../../types/nostr";
import { getSigner, getSignerTimeoutMs } from "../nostr/loginFlow";
import { signingQueue } from "../nostr/signingQueue";
import { relayManager } from "../nostr/relayManager";
import { fetchRelayList } from "../nostr/nip65";
import { BOOTSTRAP_RELAYS } from "../nostr/constants";
import {
  resolveZapEndpoint,
  requestZapInvoice,
  requestPlainInvoice,
} from "./lnurl";
import { createLogger, shortKey } from "../debug/logger";

const zapLog = createLogger("zap");

const MAX_ZAP_RELAYS = 8;
const RECIPIENT_RELAY_WAIT_MS = 4000;

/** Gather relays where the recipient's wallet should publish the kind:9735 receipt. */
async function gatherZapRelays(recipientPubkey: string): Promise<string[]> {
  const set = new Set<string>();
  for (const conn of relayManager.getWriteRelays()) set.add(conn.url);

  const recipientRelays = await new Promise<string[]>((resolve) => {
    let done = false;
    const subId = fetchRelayList(recipientPubkey, (entries) => {
      if (done) return;
      done = true;
      resolve(entries.filter((e) => e.mode !== "read").map((e) => e.url));
    });
    setTimeout(() => {
      if (done) return;
      done = true;
      relayManager.closeSubscription(subId);
      resolve([]);
    }, RECIPIENT_RELAY_WAIT_MS);
  });
  for (const url of recipientRelays) set.add(url);

  if (set.size === 0) for (const url of BOOTSTRAP_RELAYS) set.add(url);
  return [...set].slice(0, MAX_ZAP_RELAYS);
}

/**
 * Build a kind:9734 zap request and sign it. NOT published to relays — it's sent to the
 * LNURL callback. `anonymous` signs with a throwaway key instead of the user's signer.
 */
export async function buildAndSignZapRequest(opts: {
  recipientPubkey: string;
  amountMsat: number;
  relays: string[];
  comment?: string;
  event?: NostrEvent;
  lnurlBech32: string;
  anonymous?: boolean;
}): Promise<NostrEvent> {
  const base = opts.event
    ? makeZapRequest({
        event: opts.event as unknown as NostrToolsEvent,
        amount: opts.amountMsat,
        comment: opts.comment,
        relays: opts.relays,
      })
    : makeZapRequest({
        pubkey: opts.recipientPubkey,
        amount: opts.amountMsat,
        comment: opts.comment,
        relays: opts.relays,
      });

  // makeZapRequest omits the (recommended) lnurl tag — add it.
  const template = { ...base, tags: [...base.tags, ["lnurl", opts.lnurlBech32]] };

  if (opts.anonymous) {
    const sk = generateSecretKey();
    return finalizeEvent(template, sk) as unknown as NostrEvent;
  }

  const signer = getSigner();
  if (!signer) throw new Error("Not logged in.");
  const pubkey = await signer.getPublicKey();
  return signingQueue.enqueue(
    () => signer.signEvent({ ...template, pubkey }),
    getSignerTimeoutMs(),
  );
}

export interface ZapValidation {
  nostrPubkey: string;
  lnurlBech32: string;
  expectedMsat: number;
}

/** Validate a kind:9735 receipt confirming OUR zap (NIP-57 Appendix F). */
export function validateZapReceipt(receipt: NostrEvent, v: ZapValidation): boolean {
  if (receipt.pubkey !== v.nostrPubkey) return false;
  const bolt11 = receipt.tags.find((t) => t[0] === "bolt11")?.[1];
  if (!bolt11) return false;
  if (getSatoshisAmountFromBolt11(bolt11) * 1000 !== v.expectedMsat) return false;
  const lnurlTag = receipt.tags.find((t) => t[0] === "lnurl")?.[1];
  if (
    lnurlTag &&
    v.lnurlBech32 &&
    lnurlTag.toLowerCase() !== v.lnurlBech32.toLowerCase()
  ) {
    return false;
  }
  return true;
}

export interface SendZapParams {
  recipientPubkey: string;
  amountSats: number;
  comment?: string;
  event?: NostrEvent;
  lud16?: string;
  lnurl?: string;
  anonymous?: boolean;
  /** Pays the BOLT11 invoice (NWC / WebLN). Resolves with the preimage. */
  payInvoice: (invoice: string, amountMsat: number) => Promise<{ preimage: string }>;
}

export interface SendZapResult {
  invoice: string;
  preimage?: string;
  /** True when the recipient supports Nostr zaps (a 9735 receipt is expected). */
  hasReceipt: boolean;
  validation?: ZapValidation;
  receiptRelays: string[];
}

/** Full NIP-57 zap: resolve endpoint → sign 9734 → fetch invoice → pay. */
export async function sendZap(params: SendZapParams): Promise<SendZapResult> {
  const amountMsat = Math.round(params.amountSats * 1000);
  zapLog.info("send", {
    recipient: shortKey(params.recipientPubkey),
    sats: params.amountSats,
    eventKind: params.event?.kind,
    anonymous: !!params.anonymous,
    lud16: params.lud16,
    hasLnurl: !!params.lnurl,
    hasComment: !!params.comment,
  });
  if (amountMsat <= 0) throw new Error("Enter an amount greater than zero.");

  const endpoint = await resolveZapEndpoint({
    lud16: params.lud16,
    lnurl: params.lnurl,
  });
  zapLog.info("endpoint", {
    callback: endpoint.callback,
    allowsNostr: endpoint.allowsNostr,
    nostrPubkey: shortKey(endpoint.nostrPubkey),
    minSendable: endpoint.minSendable,
    maxSendable: endpoint.maxSendable,
  });

  if (endpoint.minSendable && amountMsat < endpoint.minSendable) {
    throw new Error(`Minimum is ${Math.ceil(endpoint.minSendable / 1000)} sats.`);
  }
  if (endpoint.maxSendable && amountMsat > endpoint.maxSendable) {
    throw new Error(`Maximum is ${Math.floor(endpoint.maxSendable / 1000)} sats.`);
  }

  const receiptRelays = await gatherZapRelays(params.recipientPubkey);

  let invoice: string;
  let validation: ZapValidation | undefined;
  if (endpoint.allowsNostr && endpoint.nostrPubkey) {
    const zapRequest = await buildAndSignZapRequest({
      recipientPubkey: params.recipientPubkey,
      amountMsat,
      relays: receiptRelays,
      comment: params.comment,
      event: params.event,
      lnurlBech32: endpoint.lnurlBech32,
      anonymous: params.anonymous,
    });
    zapLog.info("9734 signed", {
      id: shortKey(zapRequest.id),
      amountMsat,
      relayCount: receiptRelays.length,
    });
    invoice = await requestZapInvoice({
      callback: endpoint.callback,
      amountMsat,
      zapRequest,
      lnurlBech32: endpoint.lnurlBech32,
    });
    validation = {
      nostrPubkey: endpoint.nostrPubkey,
      lnurlBech32: endpoint.lnurlBech32,
      expectedMsat: amountMsat,
    };
  } else {
    invoice = await requestPlainInvoice(endpoint.callback, amountMsat);
  }
  zapLog.info("invoice", {
    sats: getSatoshisAmountFromBolt11(invoice),
    invoice,
  });

  let preimage: string;
  try {
    const result = await params.payInvoice(invoice, amountMsat);
    preimage = result.preimage;
    zapLog.info("paid", { preimagePrefix: preimage?.slice(0, 16) });
  } catch (e) {
    // Log the invoice alongside the error so the wallet's diagnostic (often the
    // destination node pubkey or amount) can be matched to what we actually sent.
    zapLog.warn("pay failed", {
      err: e instanceof Error ? e.message : String(e),
      invoice,
      amountMsat,
    });
    throw e;
  }

  return {
    invoice,
    preimage,
    hasReceipt: !!validation,
    validation,
    receiptRelays,
  };
}

/**
 * Subscribe to kind:9735 zap receipts for an event and sum the amounts.
 * Returns the subscription id; the caller closes it via relayManager.closeSubscription.
 */
export function fetchZapTotals(
  eventId: string,
  relayUrls: string[],
  onTotal: (total: { msat: number; count: number }) => void,
): string {
  let msat = 0;
  let count = 0;
  const seen = new Set<string>();
  return relayManager.subscribe({
    filters: [{ kinds: [9735], "#e": [eventId] }],
    relayUrls: relayUrls.length > 0 ? relayUrls : undefined,
    onEvent: (event) => {
      if (seen.has(event.id)) return;
      seen.add(event.id);
      const bolt11 = event.tags.find((t) => t[0] === "bolt11")?.[1];
      if (!bolt11) return;
      const sats = getSatoshisAmountFromBolt11(bolt11);
      if (sats <= 0) return;
      msat += sats * 1000;
      count += 1;
      onTotal({ msat, count });
    },
  });
}
