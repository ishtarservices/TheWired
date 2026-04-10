import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidEventStructure, isHex } from "../validation";
import type { NostrEvent } from "@/types/nostr";

function validEvent(): NostrEvent {
  return {
    id: "a".repeat(64),
    pubkey: "b".repeat(64),
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [["p", "c".repeat(64)]],
    content: "hello",
    sig: "d".repeat(128),
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe("isValidEventStructure", () => {
  it("accepts a valid event", () => {
    expect(isValidEventStructure(validEvent())).toBe(true);
  });

  it("rejects null/undefined", () => {
    expect(isValidEventStructure(null)).toBe(false);
    expect(isValidEventStructure(undefined)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValidEventStructure("string")).toBe(false);
    expect(isValidEventStructure(42)).toBe(false);
  });

  it("rejects missing id", () => {
    const e = { ...validEvent(), id: undefined };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects wrong id length", () => {
    const e = { ...validEvent(), id: "abc" };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects wrong pubkey length", () => {
    const e = { ...validEvent(), pubkey: "abc" };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects non-integer created_at", () => {
    const e = { ...validEvent(), created_at: 1.5 };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects string created_at", () => {
    const e = { ...validEvent(), created_at: "1000" as unknown as number };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects negative kind", () => {
    const e = { ...validEvent(), kind: -1 };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects non-integer kind", () => {
    const e = { ...validEvent(), kind: 1.5 };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects non-array tags", () => {
    const e = { ...validEvent(), tags: "not-array" as unknown as string[][] };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects tags with non-array elements", () => {
    const e = { ...validEvent(), tags: ["string" as unknown as string[]] };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects tags with non-string items", () => {
    const e = { ...validEvent(), tags: [[42 as unknown as string]] };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects non-string content", () => {
    const e = { ...validEvent(), content: 42 as unknown as string };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects wrong sig length", () => {
    const e = { ...validEvent(), sig: "abc" };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("rejects events too far in the future (>15 min)", () => {
    const e = {
      ...validEvent(),
      created_at: Math.floor(Date.now() / 1000) + 1000, // 16+ min
    };
    expect(isValidEventStructure(e)).toBe(false);
  });

  it("accepts events slightly in the future (<15 min)", () => {
    const e = {
      ...validEvent(),
      created_at: Math.floor(Date.now() / 1000) + 600, // 10 min
    };
    expect(isValidEventStructure(e)).toBe(true);
  });

  it("accepts kind:0 metadata events", () => {
    const e = { ...validEvent(), kind: 0 };
    expect(isValidEventStructure(e)).toBe(true);
  });

  it("accepts empty tags", () => {
    const e = { ...validEvent(), tags: [] };
    expect(isValidEventStructure(e)).toBe(true);
  });

  it("accepts empty content", () => {
    const e = { ...validEvent(), content: "" };
    expect(isValidEventStructure(e)).toBe(true);
  });
});

describe("isHex", () => {
  it("returns true for valid hex", () => {
    expect(isHex("0123456789abcdef")).toBe(true);
    expect(isHex("ABCDEF")).toBe(true);
  });

  it("returns false for non-hex", () => {
    expect(isHex("xyz")).toBe(false);
    expect(isHex("")).toBe(false);
    expect(isHex("12 34")).toBe(false);
  });
});
