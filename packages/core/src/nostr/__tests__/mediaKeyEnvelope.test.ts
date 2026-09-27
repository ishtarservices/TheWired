import { describe, it, expect } from "vitest";
import { DM_KINDS, DM_RUMOR_KINDS, MEDIA_KEY_MAX_SKEW_MS } from "@ishtarservices/shared-types";
import { parseDMWire, parseMediaKeyEnvelope, mediaKeyRumorTags, defaultExpirationFor } from "../dmWire";
import { KIND_DM_MEDIA_KEY } from "../../kinds";
import type { UnwrappedDM } from "../../crypto/giftWrap";

const A = "a".repeat(64);
const B = "b".repeat(64);
const KEY = "0f".repeat(32);

function dm(over: Partial<UnwrappedDM>): UnwrappedDM {
  return {
    sender: A,
    content: "",
    tags: [["p", B]],
    createdAt: 1_700_000_000,
    wrapId: "f".repeat(64),
    rumorId: "e".repeat(64),
    kind: KIND_DM_MEDIA_KEY,
    ...over,
  };
}

const valid = { v: 1, room: "space1:chan1", keys: [{ idx: 0, key: KEY }], ts: 1_700_000_000_000 };

describe("kind 20016 media_key envelope", () => {
  it("is an accepted rumor kind and expires after 120 s", () => {
    expect(KIND_DM_MEDIA_KEY).toBe(20016);
    expect(DM_KINDS.MEDIA_KEY).toBe(20016);
    expect(DM_RUMOR_KINDS).toContain(20016);
    expect(defaultExpirationFor("media_key", 1000)).toBe(1120);
    expect(MEDIA_KEY_MAX_SKEW_MS).toBe(120_000);
    expect(mediaKeyRumorTags()).toEqual([]);
  });

  it("parses a valid envelope through parseDMWire", () => {
    const w = parseDMWire(dm({ content: JSON.stringify(valid) }), B);
    expect(w.type).toBe("media_key");
    if (w.type !== "media_key") throw new Error("unreachable");
    expect(w.envelope).toEqual(valid);
    expect(w.sender).toBe(A);
  });

  it("accepts a mid-rotation envelope with two keys and lowercases hex", () => {
    const env = parseMediaKeyEnvelope({
      ...valid,
      keys: [
        { idx: 7, key: KEY.toUpperCase() },
        { idx: 8, key: KEY },
      ],
    });
    expect(env?.keys).toEqual([
      { idx: 7, key: KEY },
      { idx: 8, key: KEY },
    ]);
  });

  it.each([
    ["not json", "{"],
    ["wrong version", { ...valid, v: 2 }],
    ["missing room", { ...valid, room: undefined }],
    ["empty room", { ...valid, room: "" }],
    ["room too long", { ...valid, room: "x".repeat(300) }],
    ["no keys", { ...valid, keys: [] }],
    ["too many keys", { ...valid, keys: Array(5).fill({ idx: 0, key: KEY }) }],
    ["index below 0", { ...valid, keys: [{ idx: -1, key: KEY }] }],
    ["index above 255", { ...valid, keys: [{ idx: 256, key: KEY }] }],
    ["fractional index", { ...valid, keys: [{ idx: 1.5, key: KEY }] }],
    ["short key", { ...valid, keys: [{ idx: 0, key: "ab".repeat(31) }] }],
    ["non-hex key", { ...valid, keys: [{ idx: 0, key: "zz".repeat(32) }] }],
    ["ts not a number", { ...valid, ts: "now" }],
    ["ts infinite", { ...valid, ts: Infinity }],
    ["null", null],
    ["array", []],
  ])("rejects %s", (_label, raw) => {
    expect(parseMediaKeyEnvelope(raw)).toBeNull();
  });

  it("a malformed envelope surfaces as unknown, never as a chat message", () => {
    const w = parseDMWire(dm({ content: JSON.stringify({ ...valid, keys: [] }) }), B);
    expect(w.type).toBe("unknown");
  });

  it("ignores unknown extra fields (forward compatible)", () => {
    const env = parseMediaKeyEnvelope({ ...valid, future: true });
    expect(env).toEqual(valid);
  });
});
