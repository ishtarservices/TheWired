// NIP-98 HTTP auth for the gateway (services/gateway/internal/auth): a signed
// kind-27235 event carrying the exact url + method, base64-encoded into
// `Authorization: Nostr <b64>`. The gateway verifies the schnorr signature,
// checks created_at freshness (±60s) and the u/method tags, then injects
// X-Auth-Pubkey for the backend.

import { bytesToHex, randomBytes } from "@noble/hashes/utils";

import type { EventSigner } from "@/core/adapters";

export const HTTP_AUTH_KIND = 27235;

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64-encode a UTF-8 string. Hermes has no btoa/Buffer — pure TS. */
export function base64EncodeUtf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

/**
 * Sign a kind-27235 event for `url` + `method` and format the Authorization
 * header value. The url must be the EXACT request url (query string included).
 */
export async function buildNip98Header(
  signer: EventSigner,
  url: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
): Promise<string> {
  const pubkey = await signer.getPublicKey();
  const signed = await signer.signEvent({
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    kind: HTTP_AUTH_KIND,
    tags: [
      ["u", url],
      ["method", method],
      // created_at is second-granular: parallel requests to the same endpoint
      // would otherwise hash to identical event ids and trip the gateway's
      // single-use replay guard (401 AUTH_REPLAY on batch uploads).
      ["nonce", bytesToHex(randomBytes(16))],
    ],
    content: "",
  });
  return `Nostr ${base64EncodeUtf8(JSON.stringify(signed))}`;
}
