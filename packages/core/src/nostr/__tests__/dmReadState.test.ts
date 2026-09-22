import { describe, it, expect } from "vitest";
import {
  normalizeDMReadState,
  mergeDMReadState,
  setDMFlag,
  isDMFlagSet,
  setDMExpireAfter,
  setDMLastRead,
  compactDMReadState,
  encodeDMReadState,
  decodeDMReadState,
  emptyDMReadState,
  MUTED_FOREVER,
  TOMBSTONE_TTL_SECONDS,
} from "../dmReadState";
import { makeTestIdentity } from "../../crypto/__tests__/testSigner";

const X = "x".repeat(64);
const Y = "y".repeat(64);

describe("read-state v2", () => {
  it("normalizes a v1 record and garbage", () => {
    expect(normalizeDMReadState({ lastRead: { [X]: 5 } })).toMatchObject({ v: 2, lastRead: { [X]: 5 }, pinned: {} });
    expect(normalizeDMReadState("nope")).toEqual(emptyDMReadState());
    expect(normalizeDMReadState({ v: 2, pinned: { [X]: "bad" }, lastRead: null })).toMatchObject({ pinned: {}, lastRead: {} });
  });

  it("merge: lastRead is max; flags LWW by |stamp|; a set beats a same-second tombstone", () => {
    const a = { v: 2 as const, lastRead: { [X]: 10, [Y]: 3 }, pinned: { [X]: 100 }, archived: { [Y]: -50 }, muted: {}, expireAfter: { [X]: { s: 60, at: 1 } }, updatedAt: 100 };
    const b = { v: 2 as const, lastRead: { [X]: 7, [Y]: 9 }, pinned: { [X]: -120 }, archived: { [Y]: 50 }, muted: { [X]: MUTED_FOREVER }, expireAfter: { [X]: { s: 0, at: 2 } }, updatedAt: 120 };
    const m = mergeDMReadState(a, b);
    expect(m.lastRead).toEqual({ [X]: 10, [Y]: 9 });
    expect(m.pinned[X]).toBe(-120); // later removal wins
    expect(m.archived[Y]).toBe(50); // tie → set wins
    expect(m.muted[X]).toBe(MUTED_FOREVER);
    expect(m.expireAfter[X]).toEqual({ s: 0, at: 2 });
    expect(m.updatedAt).toBe(120);
    // commutative
    expect(mergeDMReadState(b, a)).toEqual(m);
    // idempotent
    expect(mergeDMReadState(m, m)).toEqual(m);
  });

  it("setDMFlag / isDMFlagSet round trip with tombstones and mute-until", () => {
    let r = emptyDMReadState();
    r = setDMFlag(r, "pinned", X, true, { now: 1000 });
    expect(isDMFlagSet(r, "pinned", X)).toBe(true);
    r = setDMFlag(r, "pinned", X, false, { now: 1000 });
    expect(r.pinned[X]).toBe(-1001); // out-ranks the same-second set
    expect(isDMFlagSet(r, "pinned", X)).toBe(false);
    r = setDMFlag(r, "muted", Y, true, { now: 1000, until: 2000 });
    expect(isDMFlagSet(r, "muted", Y, 1500)).toBe(true);
    expect(isDMFlagSet(r, "muted", Y, 2500)).toBe(false);
    r = setDMFlag(r, "muted", Y, true, { now: 1000 });
    expect(r.muted[Y]).toBe(MUTED_FOREVER);
  });

  it("setDMExpireAfter and setDMLastRead never go backwards", () => {
    let r = emptyDMReadState();
    r = setDMExpireAfter(r, X, 3600, 10);
    r = setDMExpireAfter(r, X, 0, 10);
    expect(r.expireAfter[X]).toEqual({ s: 0, at: 11 });
    r = setDMLastRead(r, X, 50);
    r = setDMLastRead(r, X, 40);
    expect(r.lastRead[X]).toBe(50);
  });

  it("compact drops old tombstones but keeps live flags", () => {
    const now = 10_000_000;
    const r = { ...emptyDMReadState(), pinned: { [X]: -(now - TOMBSTONE_TTL_SECONDS - 1), [Y]: -(now - 10) }, archived: { [X]: 5 } };
    const c = compactDMReadState(r, now);
    expect(c.pinned).toEqual({ [Y]: -(now - 10) });
    expect(c.archived).toEqual({ [X]: 5 });
  });

  it("encode/decode to self via nip44; decode of garbage is null", async () => {
    const me = makeTestIdentity();
    const r = setDMFlag(setDMLastRead(emptyDMReadState(), X, 5), "archived", Y, true, { now: 7 });
    const content = await encodeDMReadState(me.signer, me.pubkey, r);
    const back = await decodeDMReadState(me.signer, me.pubkey, content);
    expect(back).toEqual(r);
    expect(await decodeDMReadState(me.signer, me.pubkey, "not ciphertext")).toBeNull();
  });
});
