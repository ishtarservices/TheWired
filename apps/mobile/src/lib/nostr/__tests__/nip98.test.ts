import { generateSecretKey } from "nostr-tools";

import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import { base64EncodeUtf8, buildNip98Header, HTTP_AUTH_KIND } from "../nip98";
import { verifyEventSync } from "../verifyEvent";
import type { NostrEvent } from "@thewired/shared-types";

/** Test-side inverse of base64EncodeUtf8 (no Buffer/atob under jest-expo TS). */
function base64DecodeUtf8(b64: string): string {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | ALPHA.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

describe("base64EncodeUtf8", () => {
  it("matches the standard base64 alphabet with padding", () => {
    expect(base64EncodeUtf8("")).toBe("");
    expect(base64EncodeUtf8("f")).toBe("Zg==");
    expect(base64EncodeUtf8("fo")).toBe("Zm8=");
    expect(base64EncodeUtf8("foo")).toBe("Zm9v");
    expect(base64EncodeUtf8("foobar")).toBe("Zm9vYmFy");
  });

  it("handles multibyte utf-8", () => {
    // "⚡" is 3 bytes (e2 9a a1)
    expect(base64EncodeUtf8("⚡")).toBe("4pqh");
  });
});

describe("buildNip98Header", () => {
  it("signs a kind-27235 event with exact u/method tags", async () => {
    const signer = new LocalNsecSigner(generateSecretKey());
    const url = "https://api.thewired.app/api/spaces/my-space/members/me";
    const header = await buildNip98Header(signer, url, "POST");

    expect(header.startsWith("Nostr ")).toBe(true);
    const decoded = JSON.parse(base64DecodeUtf8(header.slice("Nostr ".length))) as NostrEvent;

    expect(decoded.kind).toBe(HTTP_AUTH_KIND);
    expect(decoded.tags).toContainEqual(["u", url]);
    expect(decoded.tags).toContainEqual(["method", "POST"]);
    expect(decoded.content).toBe("");
    // Fresh timestamp (gateway checks ±60s).
    expect(Math.abs(decoded.created_at - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5);
    // Genuinely signed — the gateway verifies the schnorr signature.
    expect(verifyEventSync(decoded)).toBe(true);
    expect(decoded.pubkey).toBe(signer.pubkey);
  });

  it("adds a unique nonce so parallel same-second requests get distinct event ids", async () => {
    const signer = new LocalNsecSigner(generateSecretKey());
    const url = "https://api.thewired.app/api/music/upload";
    // Pin the clock: identical created_at is exactly the collision that made
    // the gateway's single-use replay guard 401 parallel batch uploads.
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const [first, second] = await Promise.all([
        buildNip98Header(signer, url, "POST"),
        buildNip98Header(signer, url, "POST"),
      ]);
      const a = JSON.parse(base64DecodeUtf8(first.slice("Nostr ".length))) as NostrEvent;
      const b = JSON.parse(base64DecodeUtf8(second.slice("Nostr ".length))) as NostrEvent;

      expect(a.created_at).toBe(b.created_at);
      const nonceA = a.tags.find((t) => t[0] === "nonce")?.[1];
      const nonceB = b.tags.find((t) => t[0] === "nonce")?.[1];
      expect(nonceA).toMatch(/^[0-9a-f]{32}$/);
      expect(nonceB).toMatch(/^[0-9a-f]{32}$/);
      expect(nonceA).not.toBe(nonceB);
      expect(a.id).not.toBe(b.id);
      // Still verifiable — the gateway ignores unknown tags but re-hashes them all.
      expect(verifyEventSync(a)).toBe(true);
      expect(verifyEventSync(b)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
