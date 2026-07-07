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
});
