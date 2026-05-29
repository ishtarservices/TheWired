import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";
import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import type { NostrSigner } from "./signer";

/** The bunker has no built-in timeout, so we bound connect/getPublicKey ourselves. */
const CONNECT_TIMEOUT_MS = 60_000;

/** How long to probe the bunker's transport relays before giving up. */
const RELAY_PROBE_TIMEOUT_MS = 6_000;

/**
 * Quick check that at least one of the bunker's relays accepts a WebSocket. NIP-46
 * tunnels every request through these relays, so if none connect the bunker is
 * unreachable — fail fast with a clear message instead of waiting out the full
 * connect timeout. Skipped (returns true) where WebSocket is unavailable.
 */
function anyRelayReachable(urls: string[], timeoutMs: number): Promise<boolean> {
  if (urls.length === 0 || typeof WebSocket === "undefined") {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    let failures = 0;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    for (const url of urls) {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        if (++failures >= urls.length) finish(false);
        continue;
      }
      ws.onopen = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
        finish(true);
      };
      ws.onerror = () => {
        if (++failures >= urls.length) finish(false);
      };
    }
  });
}

/**
 * Kinds the app signs on the user's behalf. Requested up front in `connect` so the
 * bunker grants them once, instead of prompting on every background signature
 * (NIP-98 API auth 27235, NIP-42 relay auth 22242, zaps, profile/relay-list/Blossom
 * publishes, group moderation, music…). Without this the bunker pops an approval
 * per request and unapproved ones come back unsigned.
 */
const NIP46_SIGN_KINDS = [
  0, 1, 3, 5, 6, 7, 9, 13, 14, 15, 20, 21, 22, 1063, 1111, 1222, 1311, 9734,
  9000, 9001, 9005, 9007, 9009, 9021, 9022, 10000, 10001, 10002, 10003, 10030,
  10050, 10063, 10312, 22242, 24242, 27235, 30000, 30003, 30023, 30024, 30030,
  30078, 30119, 30311, 30312, 30313, 31683, 31685, 31686, 33123, 34235, 34236,
];

/** `sign_event` (all kinds on compliant bunkers) + explicit kinds (stricter ones) + encryption. */
const NIP46_PERMS = [
  "sign_event",
  ...NIP46_SIGN_KINDS.map((k) => `sign_event:${k}`),
  "nip44_encrypt",
  "nip44_decrypt",
  "nip04_encrypt",
  "nip04_decrypt",
].join(",");

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * NIP-46 remote signer ("bunker"). Wraps nostr-tools' `BunkerSigner`, which owns its
 * OWN relay pool — bunker traffic never touches our `relayManager`. The user's key
 * stays in the bunker; we hold only an ephemeral client key (passed to `connect`).
 *
 * This module is imported lazily (so `nostr-tools/nip46` stays out of the main bundle).
 */
export class Nip46Signer implements NostrSigner {
  private constructor(
    private readonly bunker: BunkerSigner,
    private readonly userPubkey: string,
  ) {}

  /**
   * Parse a `bunker://` URI, open the connection with the ephemeral client key,
   * and learn the user's pubkey. Rejects (after a timeout) if the bunker is unreachable.
   */
  static async connect(
    bunkerUri: string,
    clientSecretKey: Uint8Array,
    opts: { onAuthUrl: (url: string) => void; knownUserPubkey?: string },
  ): Promise<Nip46Signer> {
    const uri = bunkerUri.trim();
    // Reject non-bunker inputs (e.g. name@domain NIP-05) to avoid a surprise network fetch.
    if (!uri.startsWith("bunker://")) {
      throw new Error("Enter a bunker:// connection string from your remote signer.");
    }
    const bp = await parseBunkerInput(uri);
    if (!bp) throw new Error("Invalid bunker URI.");
    if (!bp.relays || bp.relays.length === 0) {
      throw new Error("This bunker URI has no relays.");
    }

    // Fail fast (and name the relay) if the bunker's transport relay is unreachable.
    const relayLabel = bp.relays.join(", ");
    if (!(await anyRelayReachable(bp.relays, RELAY_PROBE_TIMEOUT_MS))) {
      throw new Error(
        `Couldn't reach your bunker's relay (${relayLabel}). The relay may be offline — check nostr.watch, or pair your signer on a different relay.`,
      );
    }
    const offlineMsg = `Bunker didn't respond via ${relayLabel} — it may be offline, or the request wasn't approved in your signer.`;

    const bunker = BunkerSigner.fromBunker(clientSecretKey, bp, { onauth: opts.onAuthUrl });
    try {
      // nostr-tools' connect() sends no permissions, so issue the connect request
      // ourselves with the optional requested-perms arg — the bunker authorizes the
      // whole set once and auto-signs afterward.
      await withTimeout(
        bunker.sendRequest("connect", [bp.pubkey, bp.secret ?? "", NIP46_PERMS]),
        CONNECT_TIMEOUT_MS,
        offlineMsg,
      );
      const userPubkey = await withTimeout(
        bunker.getPublicKey(),
        CONNECT_TIMEOUT_MS,
        offlineMsg,
      );
      if (opts.knownUserPubkey && opts.knownUserPubkey !== userPubkey) {
        throw new Error("Bunker returned a different account than expected.");
      }
      return new Nip46Signer(bunker, userPubkey);
    } catch (err) {
      await bunker.close().catch(() => {});
      throw err;
    }
  }

  getPublicKey(): Promise<string> {
    // The user-pubkey (learned via get_public_key at connect) — NOT the remote-signer pubkey.
    return Promise.resolve(this.userPubkey);
  }

  async signEvent(unsigned: UnsignedEvent): Promise<NostrEvent> {
    const signed = await this.bunker.signEvent(unsigned);
    if (signed.pubkey !== this.userPubkey) {
      throw new Error("Bunker signed with an unexpected key.");
    }
    return {
      id: signed.id,
      pubkey: signed.pubkey,
      created_at: signed.created_at,
      kind: signed.kind,
      tags: signed.tags,
      content: signed.content,
      sig: signed.sig,
    };
  }

  /** NIP-44 via the bunker (for the DM follow-on; routes through the remote signer). */
  nip44Encrypt(thirdPartyPubkey: string, plaintext: string): Promise<string> {
    return this.bunker.nip44Encrypt(thirdPartyPubkey, plaintext);
  }

  nip44Decrypt(thirdPartyPubkey: string, ciphertext: string): Promise<string> {
    return this.bunker.nip44Decrypt(thirdPartyPubkey, ciphertext);
  }

  /** Tear down the bunker's relay pool + subscription. Call on logout / account switch. */
  async close(): Promise<void> {
    try {
      await this.bunker.close();
    } catch {
      /* already closed */
    }
  }
}
