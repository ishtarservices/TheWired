import { describe, it, expect } from "vitest";
import { resolveEmbedRef } from "../useEmbeddedEvent";
import { PROFILE_RELAYS } from "../../../lib/nostr/constants";
import type { NostrEvent } from "../../../types/nostr";

const PK = "a".repeat(64);
const ID = "b".repeat(64);

function ev(over: Partial<NostrEvent>): NostrEvent {
  return {
    id: ID,
    pubkey: PK,
    kind: 1,
    created_at: 1,
    tags: [],
    content: "",
    sig: "x",
    ...over,
  } as NostrEvent;
}

describe("resolveEmbedRef — inline note-embed resolver", () => {
  it("resolves an event-ref (hex id) to an ids filter", () => {
    const r = resolveEmbedRef({ id: ID });
    expect(r).not.toBeNull();
    expect(r!.addressable).toBe(false);
    expect(r!.id).toBe(ID);
    expect(r!.filter.ids).toEqual([ID]);
    expect(r!.match(ev({ id: ID }))).toBe(true);
    expect(r!.match(ev({ id: "c".repeat(64) }))).toBe(false);
  });

  it("normalizes an uppercase hex id to lowercase", () => {
    const r = resolveEmbedRef({ id: ID.toUpperCase() });
    expect(r!.filter.ids).toEqual([ID]);
    expect(r!.id).toBe(ID);
  });

  it("resolves an addr-ref to a pinned-author addressable filter", () => {
    const r = resolveEmbedRef({ kind: 30023, pubkey: PK, identifier: "my-slug" });
    expect(r).not.toBeNull();
    expect(r!.addressable).toBe(true);
    expect(r!.filter.kinds).toEqual([30023]);
    expect(r!.filter.authors).toEqual([PK]); // security: author pinned
    expect(r!.filter["#d"]).toEqual(["my-slug"]);
    expect(r!.match(ev({ kind: 30023, tags: [["d", "my-slug"]] }))).toBe(true);
    // same d-tag, different author → forgery, must not match
    expect(
      r!.match(ev({ kind: 30023, pubkey: "d".repeat(64), tags: [["d", "my-slug"]] })),
    ).toBe(false);
    // wrong kind must not match
    expect(r!.match(ev({ kind: 1, tags: [["d", "my-slug"]] }))).toBe(false);
  });

  it("defaults to PROFILE_RELAYS when there are no hints", () => {
    const r = resolveEmbedRef({ id: ID });
    expect(r!.relays).toEqual(PROFILE_RELAYS);
  });

  it("keeps safe relay hints but drops unsafe (private / loopback) ones", () => {
    const r = resolveEmbedRef({
      id: ID,
      relays: ["wss://relay.example.com", "wss://192.168.0.10", "wss://127.0.0.1"],
    });
    expect(r!.relays).toContain("wss://relay.example.com");
    expect(r!.relays).not.toContain("wss://192.168.0.10");
    expect(r!.relays).not.toContain("wss://127.0.0.1");
    // PROFILE_RELAYS still present as the base
    expect(r!.relays).toEqual(expect.arrayContaining(PROFILE_RELAYS));
  });

  it("falls back to PROFILE_RELAYS when every hint is unsafe", () => {
    const r = resolveEmbedRef({ id: ID, relays: ["wss://10.1.2.3"] });
    expect(r!.relays).toEqual(PROFILE_RELAYS);
  });

  it("returns null for an empty / unresolvable ref", () => {
    expect(resolveEmbedRef({})).toBeNull();
    expect(resolveEmbedRef({ id: "not-hex" })).toBeNull();
    // partial addr-ref (missing identifier) is unresolvable
    expect(resolveEmbedRef({ kind: 30023, pubkey: PK })).toBeNull();
  });
});
