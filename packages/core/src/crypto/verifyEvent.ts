import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { schnorr } from "@noble/curves/secp256k1";

/** The minimal event shape needed to verify id + signature. */
export interface VerifiableEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Recompute the event id from its NIP-01 canonical serialization and verify the
 * BIP-340 schnorr signature. Pure and dependency-light (only @noble) so it runs
 * identically inside the desktop Web Worker (the hot path), on the main thread
 * (the fail-closed fallback when the worker is unstable — see
 * verifyWorkerBridge), and inline on mobile (the VerifierAdapter for v1
 * volumes).
 *
 * Returns true only when BOTH the id matches and the signature verifies; any
 * malformed input returns false (never throws) so callers stay fail-closed.
 */
export function verifyEventSync(event: VerifiableEvent): boolean {
  try {
    const serialized = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
    const computedId = bytesToHex(sha256(utf8ToBytes(serialized)));
    if (computedId !== event.id) return false;
    return schnorr.verify(event.sig, event.id, event.pubkey);
  } catch {
    return false;
  }
}
