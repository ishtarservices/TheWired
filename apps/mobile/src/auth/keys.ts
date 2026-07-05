// ─── Key material helpers ────────────────────────────────────────────
// Pure functions over nostr-tools — no storage, no Redux. Everything the auth
// screens show or validate goes through here so it's testable in Node.

import { hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

export interface IdentityKeys {
  /** 32-byte secp256k1 secret key. */
  secretKey: Uint8Array;
  /** Hex pubkey (protocol form). */
  pubkey: string;
  /** bech32 nsec — what we persist and what users back up. */
  nsec: string;
  /** bech32 npub — the shareable identity. */
  npub: string;
}

function fromSecretKey(secretKey: Uint8Array): IdentityKeys {
  const pubkey = getPublicKey(secretKey);
  return {
    secretKey,
    pubkey,
    nsec: nip19.nsecEncode(secretKey),
    npub: nip19.npubEncode(pubkey),
  };
}

/** Fresh identity for the create-account walkthrough. */
export function generateIdentity(): IdentityKeys {
  return fromSecretKey(generateSecretKey());
}

/**
 * Parse user-supplied secret input: bech32 `nsec1…` (any case, optional
 * `nostr:` prefix) or 64-char hex. Throws a user-presentable Error.
 */
export function parseSecretInput(input: string): IdentityKeys {
  const raw = input.trim().replace(/^nostr:/i, "");
  if (!raw) throw new Error("Enter your secret key.");

  if (/^nsec1/i.test(raw)) {
    let decoded: ReturnType<typeof nip19.decode>;
    try {
      decoded = nip19.decode(raw.toLowerCase());
    } catch {
      throw new Error("That nsec doesn't decode — check for typos or missing characters.");
    }
    if (decoded.type !== "nsec") {
      throw new Error("That key decodes but isn't an nsec.");
    }
    return fromSecretKey(decoded.data);
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return fromSecretKey(hexToBytes(raw.toLowerCase()));
  }

  if (/^npub1/i.test(raw)) {
    throw new Error("That's a public key (npub) — logging in needs your secret key (nsec).");
  }

  throw new Error("Expected an nsec1… key or 64 hex characters.");
}

/** "npub1abcde…xyz12" — for compact display. */
export function truncateKey(key: string, head = 12, tail = 6): string {
  if (key.length <= head + tail + 1) return key;
  return `${key.slice(0, head)}…${key.slice(-tail)}`;
}
