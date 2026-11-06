import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";

import type { EventSigner } from "@ishtarservices/core";
import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";
import { isOwnApiUrl } from "./apiBase";
import { WIRED_CLIENT_HEADER, wiredClientHeaderValue } from "./clientIdentity";

/** A request body the NIP-98 `payload` tag can bind: the exact bytes that go
 *  on the wire. FormData is deliberately absent — the browser serializes it
 *  (boundary included) only inside fetch, so its hash cannot be known here;
 *  the gateway exempts multipart uploads from the payload requirement. */
export type Nip98Body = string | Uint8Array | ArrayBuffer | Blob;

export interface AuthSignerOptions {
  /** Sign as this key instead of the logged-in account. Anything about a
   *  shared project (upload, cover, delete, proposals) signs as its project
   *  key so the backend's owner checks see the project pubkey. */
  signer?: EventSigner;
  /** The request body as sent. When given, the event carries
   *  `["payload", sha256hex(body)]` so a captured header cannot be replayed
   *  with a different body (NIP-98 `payload` tag; the gateway verifies it). */
  body?: Nip98Body;
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

async function bodyBytes(body: Nip98Body): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await body.arrayBuffer());
}

/** Build a NIP-98 Authorization header for authenticated API requests */
export async function buildNip98Header(url: string, method: string, opts?: AuthSignerOptions): Promise<string> {
  const created_at = Math.floor(Date.now() / 1000);
  const pubkey = await withAuthSigner(opts, (s) => s.getPublicKey());
  const tags: string[][] = [
    ["u", url],
    ["method", method.toUpperCase()],
    // created_at is second-granular: parallel requests to the same endpoint
    // would otherwise hash to identical event ids and trip the gateway's
    // single-use replay guard (401 AUTH_REPLAY on batch uploads).
    ["nonce", bytesToHex(randomBytes(16))],
  ];
  if (opts?.body !== undefined) {
    tags.push(["payload", bytesToHex(sha256(await bodyBytes(opts.body)))]);
  }
  const unsignedEvent = {
    pubkey,
    created_at,
    kind: 27235,
    tags,
    content: "",
  };

  const signed = await withAuthSigner(opts, (s) => s.signEvent(unsignedEvent));
  const encoded = btoa(JSON.stringify(signed));
  return `Nostr ${encoded}`;
}

/** Authorization plus X-Wired-Client, the pair every authenticated call to
 *  our own API carries. The app header is never sent to a third party (a
 *  Blossom server, an LNURL endpoint, another relay's HTTP API): only
 *  Authorization goes on those. Spread into a fetch `headers` object. */
export async function buildAuthHeaders(
  url: string,
  method: string,
  opts?: AuthSignerOptions,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { Authorization: await buildNip98Header(url, method, opts) };
  if (isOwnApiUrl(url)) headers[WIRED_CLIENT_HEADER] = wiredClientHeaderValue();
  return headers;
}
