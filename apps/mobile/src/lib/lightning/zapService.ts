// NIP-57 zap orchestration — mobile port of the desktop lib/lightning/zap.ts:
// resolve LNURL endpoint → sign kind-9734 → fetch BOLT11 → amount-tamper
// guard → pay via NWC. Zaps are user-to-user tips, full stop (App Store
// 3.1.1) — nothing in the app is ever gated on them.

import { getSatoshisAmountFromBolt11, makeZapRequest } from "nostr-tools/nip57";
import type { Event as ToolsEvent } from "nostr-tools/pure";
import type { NostrEvent, UnsignedEvent } from "@thewired/shared-types";

import { NwcSession, parseNwcUri, NWC_SECRET_KEY } from "./nwc";
import { requestPlainInvoice, requestZapInvoice, resolveZapEndpoint } from "./lnurl";
import type { PlatformAdapters } from "@/core/adapters";

export interface SendZapParams {
  adapters: PlatformAdapters;
  recipientPubkey: string;
  amountSats: number;
  comment?: string;
  /** Zapping a specific note (else it's a profile zap). */
  event?: NostrEvent;
  /** From the recipient's kind-0. */
  lud16?: string;
  lud06?: string;
  /** Relays the wallet should publish the 9735 receipt to. */
  receiptRelays: string[];
}

export interface SendZapResult {
  preimage?: string;
  amountMsat: number;
  /** True when the recipient's endpoint supports Nostr zap receipts. */
  hasReceipt: boolean;
}

/** Read + parse the stored wallet connection, or null when not configured. */
export async function getStoredWallet(adapters: PlatformAdapters) {
  const uri = await adapters.secretStore.getSecret(NWC_SECRET_KEY);
  if (!uri) return null;
  try {
    return parseNwcUri(uri);
  } catch {
    return null;
  }
}

/** Full NIP-57 zap over the stored NWC wallet. */
export async function sendZap(params: SendZapParams): Promise<SendZapResult> {
  const { adapters } = params;
  const signer = adapters.signer;
  if (!signer) throw new Error("Sign in to send zaps.");

  const amountMsat = Math.round(params.amountSats * 1000);
  if (amountMsat <= 0) throw new Error("Enter an amount greater than zero.");

  const wallet = await getStoredWallet(adapters);
  if (!wallet) throw new Error("Connect a wallet in Settings first.");

  const endpoint = await resolveZapEndpoint({
    lud16: params.lud16,
    lnurl: params.lud06,
  });
  if (endpoint.minSendable && amountMsat < endpoint.minSendable) {
    throw new Error(`Minimum is ${Math.ceil(endpoint.minSendable / 1000)} sats.`);
  }
  if (endpoint.maxSendable && amountMsat > endpoint.maxSendable) {
    throw new Error(`Maximum is ${Math.floor(endpoint.maxSendable / 1000)} sats.`);
  }

  let invoice: string;
  let hasReceipt = false;
  if (endpoint.allowsNostr && endpoint.nostrPubkey) {
    const template = params.event
      ? makeZapRequest({
          event: params.event as unknown as ToolsEvent,
          amount: amountMsat,
          comment: params.comment,
          relays: params.receiptRelays,
        })
      : makeZapRequest({
          pubkey: params.recipientPubkey,
          amount: amountMsat,
          comment: params.comment,
          relays: params.receiptRelays,
        });
    // makeZapRequest omits the (recommended) lnurl tag — add it.
    const withLnurl = {
      ...template,
      tags: [...template.tags, ["lnurl", endpoint.lnurlBech32]],
    };
    const pubkey = await signer.getPublicKey();
    const zapRequest = await signer.signEvent({ ...withLnurl, pubkey } as UnsignedEvent);
    invoice = await requestZapInvoice({
      callback: endpoint.callback,
      amountMsat,
      zapRequest,
      lnurlBech32: endpoint.lnurlBech32,
    });
    hasReceipt = true;
  } else {
    invoice = await requestPlainInvoice(endpoint.callback, amountMsat);
  }

  // Amount-tampering guard (desktop #10): the BOLT11 comes from an untrusted
  // LNURL provider and NWC pays whatever the invoice encodes. Verify it
  // encodes exactly what we asked for BEFORE paying.
  const invoiceSats = getSatoshisAmountFromBolt11(invoice);
  if (!invoiceSats || invoiceSats <= 0) {
    throw new Error("The provider returned a zero-amount invoice. Zap cancelled — nothing was paid.");
  }
  if (Math.round(invoiceSats * 1000) !== amountMsat) {
    throw new Error(
      `Invoice mismatch: asked for ${Math.round(amountMsat / 1000)} sats, got an invoice for ${invoiceSats} sats. Zap cancelled — nothing was paid.`,
    );
  }

  // On-demand wallet socket; closed right after the payment (idle-close).
  const session = new NwcSession(wallet, adapters.ws);
  try {
    const result = await session.payInvoice(invoice, amountMsat);
    return { preimage: result.preimage, amountMsat, hasReceipt };
  } finally {
    session.close();
  }
}
