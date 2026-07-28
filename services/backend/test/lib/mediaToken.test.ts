import { describe, it, expect } from "vitest";
import { mintMediaToken, verifyMediaToken } from "../../src/lib/mediaToken.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

describe("mediaToken", () => {
  it("verifies a freshly minted token for its sha", () => {
    const { token } = mintMediaToken(SHA_A);
    expect(verifyMediaToken(SHA_A, token)).toBe(true);
  });

  it("rejects a token used for a different sha", () => {
    const { token } = mintMediaToken(SHA_A);
    expect(verifyMediaToken(SHA_B, token)).toBe(false);
  });

  it("rejects an expired token", () => {
    const { token } = mintMediaToken(SHA_A, -1); // already expired
    expect(verifyMediaToken(SHA_A, token)).toBe(false);
  });

  it("rejects a tampered expiry", () => {
    const { token } = mintMediaToken(SHA_A);
    const [, sig] = token.split(".");
    const forged = `${Math.floor(Date.now() / 1000) + 99999}.${sig}`;
    expect(verifyMediaToken(SHA_A, forged)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const { token, exp } = mintMediaToken(SHA_A);
    expect(verifyMediaToken(SHA_A, `${exp}.${"f".repeat(64)}`)).toBe(false);
    // flipping any hex char in the real sig also fails
    const [, sig] = token.split(".");
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifyMediaToken(SHA_A, `${exp}.${flipped}`)).toBe(false);
  });

  it("rejects malformed / empty tokens", () => {
    expect(verifyMediaToken(SHA_A, undefined)).toBe(false);
    expect(verifyMediaToken(SHA_A, null)).toBe(false);
    expect(verifyMediaToken(SHA_A, "")).toBe(false);
    expect(verifyMediaToken(SHA_A, "garbage")).toBe(false);
    expect(verifyMediaToken(SHA_A, ".")).toBe(false);
    expect(verifyMediaToken(SHA_A, "notanumber.deadbeef")).toBe(false);
  });

  it("returns an exp in the future for a positive ttl", () => {
    const { exp } = mintMediaToken(SHA_A, 3600);
    expect(exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
