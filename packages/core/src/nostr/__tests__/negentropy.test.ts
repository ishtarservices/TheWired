import { describe, it, expect } from "vitest";
import { Negentropy, NegentropyStorageVector, reconcileLocally } from "../negentropy";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

const id = (n: number) => bytesToHex(sha256(utf8ToBytes(`id-${n}`)));

function storage(items: Array<[number, string]>): NegentropyStorageVector {
  const s = new NegentropyStorageVector();
  for (const [ts, i] of items) s.insert(ts, i);
  s.seal();
  return s;
}

describe("negentropy (NIP-77)", () => {
  it("initial message carries the protocol version byte", () => {
    const n = new Negentropy(storage([]));
    expect(n.initiate().slice(0, 2)).toBe("61");
  });

  it("small sets: the initiator learns exactly the symmetric difference", () => {
    const client = storage([[1, id(1)], [2, id(2)], [9, id(9)]]);
    const relay = storage([[1, id(1)], [3, id(3)], [4, id(4)]]);
    const { need, have } = reconcileLocally(client, relay);
    expect(need.sort()).toEqual([id(3), id(4)].sort());
    expect(have.sort()).toEqual([id(2), id(9)].sort());
  });

  it("large sets converge across fingerprint splits", () => {
    const shared: Array<[number, string]> = [];
    for (let i = 0; i < 2000; i++) shared.push([1000 + i, id(i)]);
    const clientOnly: Array<[number, string]> = [[5000, id(9001)], [5001, id(9002)]];
    const relayOnly: Array<[number, string]> = [];
    for (let i = 0; i < 25; i++) relayOnly.push([3000 + i, id(7000 + i)]);
    const client = storage([...shared, ...clientOnly]);
    const relay = storage([...shared, ...relayOnly]);
    const { need, have } = reconcileLocally(client, relay, 4096);
    expect(new Set(need)).toEqual(new Set(relayOnly.map(([, i]) => i)));
    expect(new Set(have)).toEqual(new Set(clientOnly.map(([, i]) => i)));
  });

  it("identical sets need nothing", () => {
    const a = storage([[1, id(1)], [2, id(2)]]);
    const b = storage([[1, id(1)], [2, id(2)]]);
    expect(reconcileLocally(a, b)).toEqual({ need: [], have: [] });
  });

  it("rejects duplicate inserts and unsealed use", () => {
    const s = new NegentropyStorageVector();
    s.insert(1, id(1));
    s.insert(1, id(1));
    expect(() => s.seal()).toThrow(/duplicate/);
    const t = new NegentropyStorageVector();
    expect(() => t.size()).toThrow(/not sealed/);
  });
});
