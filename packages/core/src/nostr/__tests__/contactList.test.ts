import { describe, it, expect } from "vitest";
import {
  buildFollowListEvent,
  applyFollow,
  applyUnfollow,
} from "../contactList";

const PK = "a".repeat(64);
const A = "1".repeat(64);
const B = "2".repeat(64);

describe("buildFollowListEvent", () => {
  it("builds a kind:3 with one p-tag per follow", () => {
    const ev = buildFollowListEvent(PK, [A, B]);
    expect(ev.kind).toBe(3);
    expect(ev.pubkey).toBe(PK);
    expect(ev.content).toBe("");
    expect(ev.tags).toEqual([
      ["p", A],
      ["p", B],
    ]);
  });

  it("throws on an empty follow list (wipe guard)", () => {
    expect(() => buildFollowListEvent(PK, [])).toThrow("empty follow list");
  });
});

describe("applyFollow / applyUnfollow", () => {
  it("appends when absent and is idempotent", () => {
    expect(applyFollow([A], B)).toEqual([A, B]);
    const once = applyFollow([A], B);
    expect(applyFollow(once, B)).toBe(once); // same ref — no-op
  });

  it("removes when present and is idempotent", () => {
    expect(applyUnfollow([A, B], A)).toEqual([B]);
    const list = [A, B];
    expect(applyUnfollow(list, "3".repeat(64))).toBe(list); // same ref — no-op
  });
});
