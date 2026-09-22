import { describe, it, expect } from "vitest";
import { encryptDMFile, decryptDMFile } from "../fileCrypto";
import { utf8ToBytes } from "@noble/hashes/utils";

describe("kind-15 file crypto", () => {
  const plain = utf8ToBytes("a small jpeg, honest");

  it("round-trips with fresh key + nonce and verifies both hashes", () => {
    const enc = encryptDMFile(plain);
    expect(enc.key).toMatch(/^[0-9a-f]{64}$/);
    expect(enc.nonce).toMatch(/^[0-9a-f]{24}$/);
    expect(enc.size).toBe(plain.length + 16);
    expect(enc.ciphertext).not.toEqual(plain);
    const dec = decryptDMFile(enc.ciphertext, enc);
    expect(Array.from(dec)).toEqual(Array.from(plain));
  });

  it("fails closed on a swapped blob (x) or a tampered tag", () => {
    const enc = encryptDMFile(plain);
    const other = encryptDMFile(utf8ToBytes("different"));
    expect(() => decryptDMFile(other.ciphertext, enc)).toThrow(/x/);
    const flipped = new Uint8Array(enc.ciphertext);
    flipped[flipped.length - 1] ^= 0x01;
    expect(() => decryptDMFile(flipped, { key: enc.key, nonce: enc.nonce })).toThrow();
  });

  it("fails closed when the plaintext hash (ox) does not match", () => {
    const enc = encryptDMFile(plain);
    expect(() => decryptDMFile(enc.ciphertext, { ...enc, ox: "0".repeat(64) })).toThrow(/ox/);
  });

  it("rejects wrong key/nonce sizes", () => {
    expect(() => encryptDMFile(plain, { key: new Uint8Array(16) })).toThrow(/32 bytes/);
    expect(() => decryptDMFile(plain, { key: "aa", nonce: "bb" })).toThrow();
  });
});
