/**
 * Test users for backend tests.
 *
 * Keys are loaded from environment variables (set via .env.test at repo root).
 * If a key is missing, a deterministic one is generated from the user name.
 */
import { nip19, getPublicKey } from "nostr-tools";
import { sha256 } from "@noble/hashes/sha2";

export interface TestUser {
  name: string;
  secretKey: Uint8Array;
  pubkey: string;
}

function decodeNsec(nsec: string): Uint8Array {
  const decoded = nip19.decode(nsec);
  if (decoded.type !== "nsec") throw new Error(`Expected nsec`);
  return decoded.data;
}

function deterministicKey(label: string): Uint8Array {
  return sha256(new TextEncoder().encode(`thewired-test-user:${label}`));
}

function fromEnv(name: string, envVar: string): TestUser {
  const nsec = process.env[envVar];
  const secretKey = nsec ? decodeNsec(nsec) : deterministicKey(name);
  return { name, secretKey, pubkey: getPublicKey(secretKey) };
}

/** Space creator / admin */
export const LUNA = fromEnv("Luna Vega", "TEST_NSEC_LUNA_VEGA");
/** Space member */
export const MARCUS = fromEnv("Marcus Cole", "TEST_NSEC_MARCUS_COLE");
/** Invited user */
export const SAGE = fromEnv("Sage Nakamura", "TEST_NSEC_SAGE_NAKAMURA");
/** Banned/muted user */
export const ZARA = fromEnv("Zara Williams", "TEST_NSEC_ZARA_WILLIAMS");
/** Moderator */
export const DECKARD = fromEnv("Deckard Stone", "TEST_NSEC_DECKARD_STONE");
/** Non-member / outsider */
export const JAYDEE = fromEnv("JayDee", "TEST_NSEC_JAYDEE");
