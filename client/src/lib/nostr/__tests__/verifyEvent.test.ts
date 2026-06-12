import { describe, it, expect } from "vitest";
import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { verifyEventSync, type VerifiableEvent } from "../verifyEvent";

/** Build a genuinely schnorr-signed event with a correct id. */
function signed(over: Partial<VerifiableEvent> = {}): VerifiableEvent {
  const sk = schnorr.utils.randomPrivateKey();
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const created_at = over.created_at ?? 1_700_000_000;
  const kind = over.kind ?? 1;
  const tags = over.tags ?? [];
  const content = over.content ?? "hello";
  const ser = JSON.stringify([0, pubkey, created_at, kind, tags, content]);
  const id = bytesToHex(sha256(new TextEncoder().encode(ser)));
  const sig = bytesToHex(schnorr.sign(id, sk));
  return { id, pubkey, created_at, kind, tags, content, sig, ...over };
}

describe("verifyEventSync", () => {
  it("accepts a correctly-signed event", () => {
    expect(verifyEventSync(signed())).toBe(true);
  });

  it("rejects a tampered content (id no longer matches)", () => {
    const ev = signed({ content: "original" });
    expect(verifyEventSync({ ...ev, content: "tampered" })).toBe(false);
  });

  it("rejects a forged id", () => {
    const ev = signed();
    expect(verifyEventSync({ ...ev, id: "00".repeat(32) })).toBe(false);
  });

  it("rejects a bad signature", () => {
    const ev = signed();
    expect(verifyEventSync({ ...ev, sig: "00".repeat(64) })).toBe(false);
  });

  it("returns false (never throws) on malformed input", () => {
    expect(verifyEventSync({ id: "x", pubkey: "y", created_at: 0, kind: 1, tags: [], content: "", sig: "z" })).toBe(false);
  });
});
