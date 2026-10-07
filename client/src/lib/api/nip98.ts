import { bytesToHex, randomBytes } from "@noble/hashes/utils";

import type { EventSigner } from "@ishtarservices/core";
import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";

export interface AuthSignerOptions {
  /** Sign as this key instead of the logged-in account. Anything about a
   *  shared project (upload, cover, delete, proposals) signs as its project
   *  key so the backend's owner checks see the project pubkey. */
  signer?: EventSigner;
}

/** Run a signer call: an explicit (local) signer directly, the account signer
 *  through the signing queue. */
export async function withAuthSigner<T>(
  opts: AuthSignerOptions | undefined,
  fn: (signer: EventSigner) => Promise<T>,
): Promise<T> {
  if (opts?.signer) return fn(opts.signer);
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");
  return signingQueue.enqueue(() => fn(signer));
}

/** Build a NIP-98 Authorization header for authenticated API requests */
export async function buildNip98Header(url: string, method: string, opts?: AuthSignerOptions): Promise<string> {
  const created_at = Math.floor(Date.now() / 1000);
  const pubkey = await withAuthSigner(opts, (s) => s.getPublicKey());
  const unsignedEvent = {
    pubkey,
    created_at,
    kind: 27235,
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
      // created_at is second-granular: parallel requests to the same endpoint
      // would otherwise hash to identical event ids and trip the gateway's
      // single-use replay guard (401 AUTH_REPLAY on batch uploads).
      ["nonce", bytesToHex(randomBytes(16))],
    ],
    content: "",
  };

  const signed = await withAuthSigner(opts, (s) => s.signEvent(unsignedEvent));
  const encoded = btoa(JSON.stringify(signed));
  return `Nostr ${encoded}`;
}
