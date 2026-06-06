import { describe, it, expect } from "vitest";
import { parseProfile } from "../profileParser";
import type { NostrEvent } from "../../../types/nostr";

/** Minimal kind:0 event — parseProfile only reads kind/content/created_at. */
function k0(content: string, created_at = 1000): NostrEvent {
  return {
    id: "0".repeat(64),
    pubkey: "a".repeat(64),
    kind: 0,
    content,
    created_at,
    tags: [],
    sig: "0".repeat(128),
  } as NostrEvent;
}

describe("parseProfile", () => {
  it("returns null for a non-kind:0 event", () => {
    expect(parseProfile({ ...k0("{}"), kind: 1 } as NostrEvent)).toBeNull();
  });

  it("normalizes the modeled string fields", () => {
    const p = parseProfile(
      k0(JSON.stringify({ name: "Luna", display_name: "Luna V", nip05: "luna@x", lud16: "luna@x.com", website: "https://x" })),
    );
    expect(p?.name).toBe("Luna");
    expect(p?.display_name).toBe("Luna V");
    expect(p?.nip05).toBe("luna@x");
    expect(p?.lud16).toBe("luna@x.com");
  });

  it("extracts lud06", () => {
    const p = parseProfile(k0(JSON.stringify({ lud06: "lnurl1abc" })));
    expect(p?.lud06).toBe("lnurl1abc");
  });

  it("coerces non-string modeled fields to undefined", () => {
    const p = parseProfile(k0(JSON.stringify({ name: 42, about: { x: 1 }, nip05: ["a"] })));
    expect(p?.name).toBeUndefined();
    expect(p?.about).toBeUndefined();
    expect(p?.nip05).toBeUndefined();
  });

  it("preserves unknown fields so a republish doesn't drop them", () => {
    const p = parseProfile(k0(JSON.stringify({ name: "Luna", bot: true, customField: "keep" })));
    expect((p as Record<string, unknown>).bot).toBe(true);
    expect((p as Record<string, unknown>).customField).toBe("keep");
  });

  it("stamps created_at from the event, not the content", () => {
    const p = parseProfile(k0(JSON.stringify({ name: "Luna", created_at: 5 }), 9999));
    expect(p?.created_at).toBe(9999);
  });

  it("returns null on invalid JSON", () => {
    expect(parseProfile(k0("not json"))).toBeNull();
    expect(parseProfile(k0(""))).toBeNull();
  });

  it("returns null on non-object JSON (primitive / array)", () => {
    expect(parseProfile(k0('"a string"'))).toBeNull();
    expect(parseProfile(k0("42"))).toBeNull();
    expect(parseProfile(k0("null"))).toBeNull();
    expect(parseProfile(k0('["arr"]'))).toBeNull();
  });

  it("strips prototype-pollution keys and never pollutes Object.prototype", () => {
    const p = parseProfile(
      k0('{"name":"Luna","__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2}}'),
    );
    const own = (o: unknown, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    expect(p?.name).toBe("Luna");
    expect(own(p, "__proto__")).toBe(false);
    expect(own(p, "constructor")).toBe(false);
    expect(own(p, "prototype")).toBe(false);
    // Nothing leaked onto the global prototype.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});
