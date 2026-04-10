/**
 * Test users with Nostr keypairs for testing.
 *
 * Keys are loaded from environment variables (set via .env.test at repo root).
 * If a key is missing, a deterministic one is generated from the user name
 * so tests are stable across runs even without .env.test.
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
  if (decoded.type !== "nsec") throw new Error(`Expected nsec, got ${decoded.type}`);
  return decoded.data;
}

/** Derive a deterministic secret key from a label (fallback when env is missing) */
function deterministicKey(label: string): Uint8Array {
  return sha256(new TextEncoder().encode(`thewired-test-user:${label}`));
}

function createTestUser(name: string, envVar: string): TestUser {
  const nsec = import.meta.env[envVar] as string | undefined;
  const secretKey = nsec ? decodeNsec(nsec) : deterministicKey(name);
  const pubkey = getPublicKey(secretKey);
  return { name, secretKey, pubkey };
}

/** Space creator / admin */
export const lunaVega = createTestUser("Luna Vega", "TEST_NSEC_LUNA_VEGA");

/** Space member */
export const marcusCole = createTestUser("Marcus Cole", "TEST_NSEC_MARCUS_COLE");

/** Invited user (joins via invite) */
export const sageNakamura = createTestUser("Sage Nakamura", "TEST_NSEC_SAGE_NAKAMURA");

/** Banned/muted user */
export const zaraWilliams = createTestUser("Zara Williams", "TEST_NSEC_ZARA_WILLIAMS");

/** Moderator role */
export const deckardStone = createTestUser("Deckard Stone", "TEST_NSEC_DECKARD_STONE");

/** Second account for multi-account tests */
export const niaOkafor = createTestUser("Nia Okafor", "TEST_NSEC_NIA_OKAFOR");

/** DM counterpart */
export const riverChen = createTestUser("River Chen", "TEST_NSEC_RIVER_CHEN");

/** Music artist */
export const felixMoreau = createTestUser("Felix Moreau", "TEST_NSEC_FELIX_MOREAU");

/** Read-only space member */
export const ariaBlackwood = createTestUser("Aria Blackwood", "TEST_NSEC_ARIA_BLACKWOOD");

/** Anonymous / non-member */
export const jayDee = createTestUser("JayDee", "TEST_NSEC_JAYDEE");

/** All test users in an array for convenience */
export const ALL_TEST_USERS: TestUser[] = [
  lunaVega,
  marcusCole,
  sageNakamura,
  zaraWilliams,
  deckardStone,
  niaOkafor,
  riverChen,
  felixMoreau,
  ariaBlackwood,
  jayDee,
];
