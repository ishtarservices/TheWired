import { bytesToHex } from "@noble/hashes/utils";
import { nip19 } from "nostr-tools";

import { generateIdentity, parseSecretInput, truncateKey } from "../keys";

describe("generateIdentity", () => {
  it("produces a coherent key set", () => {
    const id = generateIdentity();
    expect(id.secretKey).toHaveLength(32);
    expect(id.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(id.nsec).toMatch(/^nsec1/);
    expect(id.npub).toMatch(/^npub1/);

    // bech32 forms decode back to the same material
    expect(nip19.decode(id.npub).data).toBe(id.pubkey);
    expect(nip19.decode(id.nsec).data).toEqual(id.secretKey);
  });

  it("generates distinct identities", () => {
    expect(generateIdentity().pubkey).not.toBe(generateIdentity().pubkey);
  });
});

describe("parseSecretInput", () => {
  const id = generateIdentity();

  it("accepts an nsec", () => {
    expect(parseSecretInput(id.nsec).pubkey).toBe(id.pubkey);
  });

  it("accepts surrounding whitespace, nostr: prefix, and uppercase bech32", () => {
    expect(parseSecretInput(`  nostr:${id.nsec}\n`).pubkey).toBe(id.pubkey);
    expect(parseSecretInput(id.nsec.toUpperCase()).pubkey).toBe(id.pubkey);
  });

  it("accepts 64-char hex (either case)", () => {
    const hex = bytesToHex(id.secretKey);
    expect(parseSecretInput(hex).pubkey).toBe(id.pubkey);
    expect(parseSecretInput(hex.toUpperCase()).pubkey).toBe(id.pubkey);
  });

  it("rejects an npub with a pointed message", () => {
    expect(() => parseSecretInput(id.npub)).toThrow(/public key/);
  });

  it("rejects empties, garbage and corrupted nsecs", () => {
    expect(() => parseSecretInput("")).toThrow();
    expect(() => parseSecretInput("hello world")).toThrow(/nsec1… key or 64 hex/);
    expect(() => parseSecretInput(id.nsec.slice(0, -4) + "zzzz")).toThrow(/doesn't decode/);
    expect(() => parseSecretInput("deadbeef")).toThrow(); // hex but too short
  });
});

describe("truncateKey", () => {
  it("shortens long keys and leaves short strings alone", () => {
    const id = generateIdentity();
    const short = truncateKey(id.npub);
    expect(short.length).toBeLessThan(id.npub.length);
    expect(short).toContain("…");
    expect(truncateKey("abc")).toBe("abc");
  });
});
