import { describe, it, expect } from "vitest";
import { nip19 } from "nostr-tools";
import { toHexPubkey, clampContent, clampTitle, asString } from "../tools/validate";

const HEX = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

describe("toHexPubkey", () => {
  it("accepts and lowercases 64-char hex", () => {
    expect(toHexPubkey(HEX.toUpperCase())).toBe(HEX);
  });

  it("decodes npub to hex", () => {
    expect(toHexPubkey(nip19.npubEncode(HEX))).toBe(HEX);
  });

  it("rejects garbage / names / wrong length", () => {
    expect(toHexPubkey("alice")).toBeNull();
    expect(toHexPubkey("abc")).toBeNull();
    expect(toHexPubkey(123)).toBeNull();
  });
});

describe("clamping", () => {
  it("clampContent caps length", () => {
    expect(clampContent("x".repeat(10000)).length).toBe(8000);
    expect(clampContent("hi")).toBe("hi");
  });

  it("clampTitle trims + caps", () => {
    expect(clampTitle("  hello  ")).toBe("hello");
    expect(clampTitle("t".repeat(500)).length).toBe(200);
  });

  it("asString coerces safely", () => {
    expect(asString(null)).toBe("");
    expect(asString(7)).toBe("7");
    expect(asString("s")).toBe("s");
  });
});
