import { bytesToHex, randomBytes } from "@noble/hashes/utils";

import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";

/** Build a NIP-98 Authorization header for authenticated API requests */
export async function buildNip98Header(url: string, method: string): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const created_at = Math.floor(Date.now() / 1000);
  const pubkey = await signingQueue.enqueue(() => signer.getPublicKey());
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

  const signed = await signingQueue.enqueue(() => signer.signEvent(unsignedEvent));
  const encoded = btoa(JSON.stringify(signed));
  return `Nostr ${encoded}`;
}
