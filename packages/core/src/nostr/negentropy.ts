// NIP-77 negentropy (protocol V1) — a typed port of the reference JavaScript
// implementation (Doug Hoyte, MIT; as bundled in nostr-tools' unexported
// `nip77` module). Pure TS on @noble hashes so it runs on desktop (WebView),
// mobile (Hermes) and Node. Both roles are supported: the initiator
// (`initiate()` + `reconcile()` until it returns null) and the responder.
//
// Wire: docs/DM_WIRE_CONTRACT.md §7.5. Records are (timestamp, 32-byte id),
// sorted by timestamp then id; fingerprints are sha256(sum(ids) mod 2^256 ‖
// varint(count))[0..16].

import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

export const NEGENTROPY_PROTOCOL_VERSION = 0x61;
const ID_SIZE = 32;
const FINGERPRINT_SIZE = 16;

const enum Mode {
  Skip = 0,
  Fingerprint = 1,
  IdList = 2,
}

export interface NegentropyItem {
  timestamp: number;
  id: Uint8Array;
}

interface Bound {
  timestamp: number;
  id: Uint8Array;
}

class WrappedBuffer {
  private raw: Uint8Array;
  length: number;

  constructor(buffer?: Uint8Array | number) {
    if (typeof buffer === "number") {
      this.raw = new Uint8Array(buffer);
      this.length = 0;
    } else if (buffer instanceof Uint8Array) {
      this.raw = new Uint8Array(buffer);
      this.length = buffer.length;
    } else {
      this.raw = new Uint8Array(512);
      this.length = 0;
    }
  }

  unwrap(): Uint8Array {
    return this.raw.subarray(0, this.length);
  }

  get capacity(): number {
    return this.raw.byteLength;
  }

  extend(buf: Uint8Array | WrappedBuffer): void {
    const bytes = buf instanceof WrappedBuffer ? buf.unwrap() : buf;
    const targetSize = bytes.length + this.length;
    if (this.capacity < targetSize) {
      const oldRaw = this.raw;
      this.raw = new Uint8Array(Math.max(this.capacity * 2, targetSize));
      this.raw.set(oldRaw);
    }
    this.raw.set(bytes, this.length);
    this.length += bytes.length;
  }

  shift(): number {
    const first = this.raw[0];
    this.raw = this.raw.subarray(1);
    this.length--;
    return first;
  }

  shiftN(n = 1): Uint8Array {
    const first = this.raw.subarray(0, n);
    this.raw = this.raw.subarray(n);
    this.length -= n;
    return first;
  }
}

function decodeVarInt(buf: WrappedBuffer): number {
  let res = 0;
  for (;;) {
    if (buf.length === 0) throw new Error("parse ends prematurely");
    const byte = buf.shift();
    res = (res << 7) | (byte & 127);
    if ((byte & 128) === 0) break;
  }
  return res;
}

function encodeVarInt(n: number): WrappedBuffer {
  if (n === 0) return new WrappedBuffer(new Uint8Array([0]));
  const o: number[] = [];
  while (n !== 0) {
    o.push(n & 127);
    n >>>= 7;
  }
  o.reverse();
  for (let i = 0; i < o.length - 1; i++) o[i] |= 128;
  return new WrappedBuffer(new Uint8Array(o));
}

function getByte(buf: WrappedBuffer): number {
  return getBytes(buf, 1)[0];
}

function getBytes(buf: WrappedBuffer, n: number): Uint8Array {
  if (buf.length < n) throw new Error("parse ends prematurely");
  return buf.shiftN(n);
}

function compareUint8Array(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  if (a.byteLength > b.byteLength) return 1;
  if (a.byteLength < b.byteLength) return -1;
  return 0;
}

function itemCompare(a: NegentropyItem, b: NegentropyItem): number {
  if (a.timestamp === b.timestamp) return compareUint8Array(a.id, b.id);
  return a.timestamp - b.timestamp;
}

class Accumulator {
  private buf!: Uint8Array;

  constructor() {
    this.setToZero();
  }

  setToZero(): void {
    this.buf = new Uint8Array(ID_SIZE);
  }

  add(otherBuf: Uint8Array): void {
    let currCarry = 0;
    let nextCarry = 0;
    const p = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    const po = new DataView(otherBuf.buffer, otherBuf.byteOffset, otherBuf.byteLength);
    for (let i = 0; i < 8; i++) {
      const offset = i * 4;
      const orig = p.getUint32(offset, true);
      const otherV = po.getUint32(offset, true);
      let next = orig;
      next += currCarry;
      next += otherV;
      if (next > 4294967295) nextCarry = 1;
      p.setUint32(offset, next & 4294967295, true);
      currCarry = nextCarry;
      nextCarry = 0;
    }
  }

  getFingerprint(n: number): Uint8Array {
    const input = new WrappedBuffer();
    input.extend(this.buf);
    input.extend(encodeVarInt(n));
    return sha256(input.unwrap()).subarray(0, FINGERPRINT_SIZE);
  }
}

/** Sorted in-memory record set. Insert, seal, then hand to `Negentropy`. */
export class NegentropyStorageVector {
  items: NegentropyItem[] = [];
  sealed = false;

  insert(timestamp: number, id: string): void {
    if (this.sealed) throw new Error("already sealed");
    const idb = hexToBytes(id);
    if (idb.byteLength !== ID_SIZE) throw new Error("bad id size for added item");
    this.items.push({ timestamp, id: idb });
  }

  seal(): void {
    if (this.sealed) throw new Error("already sealed");
    this.sealed = true;
    this.items.sort(itemCompare);
    for (let i = 1; i < this.items.length; i++) {
      if (itemCompare(this.items[i - 1], this.items[i]) === 0) throw new Error("duplicate item inserted");
    }
  }

  unseal(): void {
    this.sealed = false;
  }

  size(): number {
    this.checkSealed();
    return this.items.length;
  }

  getItem(i: number): NegentropyItem {
    this.checkSealed();
    if (i >= this.items.length) throw new Error("out of range");
    return this.items[i];
  }

  iterate(begin: number, end: number, cb: (item: NegentropyItem, i: number) => boolean): void {
    this.checkSealed();
    this.checkBounds(begin, end);
    for (let i = begin; i < end; ++i) {
      if (!cb(this.items[i], i)) break;
    }
  }

  findLowerBound(begin: number, end: number, bound: Bound): number {
    this.checkSealed();
    this.checkBounds(begin, end);
    let first = begin;
    let count = end - begin;
    while (count > 0) {
      let it = first;
      const step = Math.floor(count / 2);
      it += step;
      if (itemCompare(this.items[it], bound) < 0) {
        first = ++it;
        count -= step + 1;
      } else {
        count = step;
      }
    }
    return first;
  }

  fingerprint(begin: number, end: number): Uint8Array {
    const out = new Accumulator();
    this.iterate(begin, end, (item) => {
      out.add(item.id);
      return true;
    });
    return out.getFingerprint(end - begin);
  }

  private checkSealed(): void {
    if (!this.sealed) throw new Error("not sealed");
  }

  private checkBounds(begin: number, end: number): void {
    if (begin > end || end > this.items.length) throw new Error("bad range");
  }
}

/** One side of a reconciliation. Messages are hex strings (as on the wire). */
export class Negentropy {
  private storage: NegentropyStorageVector;
  private frameSizeLimit: number;
  private lastTimestampIn = 0;
  private lastTimestampOut = 0;
  private isInitiator = false;

  constructor(storage: NegentropyStorageVector, frameSizeLimit = 60_000) {
    if (frameSizeLimit < 4096) throw new Error("frameSizeLimit too small");
    this.storage = storage;
    this.frameSizeLimit = frameSizeLimit;
  }

  private bound(timestamp: number, id?: Uint8Array): Bound {
    return { timestamp, id: id ?? new Uint8Array(0) };
  }

  /** The initiator's first message (hex). */
  initiate(): string {
    this.isInitiator = true;
    const output = new WrappedBuffer();
    output.extend(new Uint8Array([NEGENTROPY_PROTOCOL_VERSION]));
    this.splitRange(0, this.storage.size(), this.bound(Number.MAX_VALUE), output);
    return bytesToHex(output.unwrap());
  }

  /**
   * Process one incoming message. Returns the next message to send, or null
   * when the initiator has nothing left to ask. `onhave` receives ids we hold
   * that the other side lacks; `onneed` ids they hold that we lack.
   */
  reconcile(queryMsg: string, onhave?: (id: string) => void, onneed?: (id: string) => void): string | null {
    const query = new WrappedBuffer(hexToBytes(queryMsg));
    this.lastTimestampIn = this.lastTimestampOut = 0;
    const fullOutput = new WrappedBuffer();
    fullOutput.extend(new Uint8Array([NEGENTROPY_PROTOCOL_VERSION]));

    const protocolVersion = getByte(query);
    if (protocolVersion < 0x60 || protocolVersion > 0x6f) {
      throw new Error("invalid negentropy protocol version byte");
    }
    if (protocolVersion !== NEGENTROPY_PROTOCOL_VERSION) {
      throw new Error(`unsupported negentropy protocol version requested: ${protocolVersion - 0x60}`);
    }

    const storageSize = this.storage.size();
    let prevBound = this.bound(0);
    let prevIndex = 0;
    let skip = false;

    while (query.length !== 0) {
      const o = new WrappedBuffer();
      const doSkip = () => {
        if (skip) {
          skip = false;
          o.extend(this.encodeBound(prevBound));
          o.extend(encodeVarInt(Mode.Skip));
        }
      };

      const currBound = this.decodeBound(query);
      const mode = decodeVarInt(query);
      const lower = prevIndex;
      const upper = this.storage.findLowerBound(prevIndex, storageSize, currBound);

      if (mode === Mode.Skip) {
        skip = true;
      } else if (mode === Mode.Fingerprint) {
        const theirFingerprint = getBytes(query, FINGERPRINT_SIZE);
        const ourFingerprint = this.storage.fingerprint(lower, upper);
        if (compareUint8Array(theirFingerprint, ourFingerprint) !== 0) {
          doSkip();
          this.splitRange(lower, upper, currBound, o);
        } else {
          skip = true;
        }
      } else if (mode === Mode.IdList) {
        const numIds = decodeVarInt(query);
        const theirElems: Record<string, Uint8Array> = {};
        for (let i = 0; i < numIds; i++) {
          const e = getBytes(query, ID_SIZE);
          theirElems[bytesToHex(e)] = e;
        }
        this.storage.iterate(lower, upper, (item) => {
          const id = bytesToHex(item.id);
          if (!theirElems[id]) {
            if (this.isInitiator) onhave?.(id);
          } else {
            delete theirElems[id];
          }
          return true;
        });
        if (this.isInitiator) {
          skip = true;
          if (onneed) {
            for (const v of Object.values(theirElems)) onneed(bytesToHex(v));
          }
        } else {
          // Responder (the relay role, as in the C++/Rust references): answer
          // with our own ids for the range, shrinking the range if the frame
          // would overflow so the remainder gets a fingerprint below.
          doSkip();
          const responseIds = new WrappedBuffer();
          let numResponseIds = 0;
          let endBound = currBound;
          let shrunkUpper = upper;
          this.storage.iterate(lower, upper, (item, index) => {
            if (this.exceededFrameSizeLimit(fullOutput.length + responseIds.length)) {
              endBound = { timestamp: item.timestamp, id: item.id };
              shrunkUpper = index;
              return false;
            }
            responseIds.extend(item.id);
            numResponseIds++;
            return true;
          });
          o.extend(this.encodeBound(endBound));
          o.extend(encodeVarInt(Mode.IdList));
          o.extend(encodeVarInt(numResponseIds));
          o.extend(responseIds);
          fullOutput.extend(o);
          o.length = 0;
          if (shrunkUpper !== upper) {
            const remainingFingerprint = this.storage.fingerprint(shrunkUpper, storageSize);
            fullOutput.extend(this.encodeBound(this.bound(Number.MAX_VALUE)));
            fullOutput.extend(encodeVarInt(Mode.Fingerprint));
            fullOutput.extend(remainingFingerprint);
            break;
          }
        }
      } else {
        throw new Error("unexpected mode");
      }

      if (this.exceededFrameSizeLimit(fullOutput.length + o.length)) {
        const remainingFingerprint = this.storage.fingerprint(upper, storageSize);
        fullOutput.extend(this.encodeBound(this.bound(Number.MAX_VALUE)));
        fullOutput.extend(encodeVarInt(Mode.Fingerprint));
        fullOutput.extend(remainingFingerprint);
        break;
      } else {
        fullOutput.extend(o);
      }
      prevIndex = upper;
      prevBound = currBound;
    }

    return fullOutput.length === 1 ? null : bytesToHex(fullOutput.unwrap());
  }

  private splitRange(lower: number, upper: number, upperBound: Bound, o: WrappedBuffer): void {
    const numElems = upper - lower;
    const buckets = 16;
    if (numElems < buckets * 2) {
      o.extend(this.encodeBound(upperBound));
      o.extend(encodeVarInt(Mode.IdList));
      o.extend(encodeVarInt(numElems));
      this.storage.iterate(lower, upper, (item) => {
        o.extend(item.id);
        return true;
      });
    } else {
      const itemsPerBucket = Math.floor(numElems / buckets);
      const bucketsWithExtra = numElems % buckets;
      let curr = lower;
      for (let i = 0; i < buckets; i++) {
        const bucketSize = itemsPerBucket + (i < bucketsWithExtra ? 1 : 0);
        const ourFingerprint = this.storage.fingerprint(curr, curr + bucketSize);
        curr += bucketSize;
        let nextBound: Bound;
        if (curr === upper) {
          nextBound = upperBound;
        } else {
          let prevItem: NegentropyItem | undefined;
          let currItem: NegentropyItem | undefined;
          this.storage.iterate(curr - 1, curr + 1, (item, index) => {
            if (index === curr - 1) prevItem = item;
            else currItem = item;
            return true;
          });
          nextBound = this.getMinimalBound(prevItem!, currItem!);
        }
        o.extend(this.encodeBound(nextBound));
        o.extend(encodeVarInt(Mode.Fingerprint));
        o.extend(ourFingerprint);
      }
    }
  }

  private exceededFrameSizeLimit(n: number): boolean {
    return n > this.frameSizeLimit - 200;
  }

  private decodeTimestampIn(encoded: WrappedBuffer): number {
    let timestamp = decodeVarInt(encoded);
    timestamp = timestamp === 0 ? Number.MAX_VALUE : timestamp - 1;
    if (this.lastTimestampIn === Number.MAX_VALUE || timestamp === Number.MAX_VALUE) {
      this.lastTimestampIn = Number.MAX_VALUE;
      return Number.MAX_VALUE;
    }
    timestamp += this.lastTimestampIn;
    this.lastTimestampIn = timestamp;
    return timestamp;
  }

  private decodeBound(encoded: WrappedBuffer): Bound {
    const timestamp = this.decodeTimestampIn(encoded);
    const len = decodeVarInt(encoded);
    if (len > ID_SIZE) throw new Error("bound key too long");
    const id = getBytes(encoded, len);
    return { timestamp, id };
  }

  private encodeTimestampOut(timestamp: number): WrappedBuffer {
    if (timestamp === Number.MAX_VALUE) {
      this.lastTimestampOut = Number.MAX_VALUE;
      return encodeVarInt(0);
    }
    const temp = timestamp;
    timestamp -= this.lastTimestampOut;
    this.lastTimestampOut = temp;
    return encodeVarInt(timestamp + 1);
  }

  private encodeBound(key: Bound): WrappedBuffer {
    const output = new WrappedBuffer();
    output.extend(this.encodeTimestampOut(key.timestamp));
    output.extend(encodeVarInt(key.id.length));
    output.extend(key.id);
    return output;
  }

  private getMinimalBound(prev: NegentropyItem, curr: NegentropyItem): Bound {
    if (curr.timestamp !== prev.timestamp) return this.bound(curr.timestamp);
    let sharedPrefixBytes = 0;
    for (let i = 0; i < ID_SIZE; i++) {
      if (curr.id[i] !== prev.id[i]) break;
      sharedPrefixBytes++;
    }
    return this.bound(curr.timestamp, curr.id.subarray(0, sharedPrefixBytes + 1));
  }
}

/**
 * Convenience: run a full reconciliation between two in-memory sets (both
 * roles locally). Returns what the initiator learns. Used by tests and by
 * clients that want to diff two local snapshots.
 */
export function reconcileLocally(
  initiator: NegentropyStorageVector,
  responder: NegentropyStorageVector,
  frameSizeLimit = 60_000,
): { need: string[]; have: string[] } {
  const a = new Negentropy(initiator, frameSizeLimit);
  const b = new Negentropy(responder, frameSizeLimit);
  const need: string[] = [];
  const have: string[] = [];
  let msg: string | null = a.initiate();
  for (let round = 0; msg !== null && round < 1000; round++) {
    const reply = b.reconcile(msg);
    if (reply === null) break;
    msg = a.reconcile(reply, (id) => have.push(id), (id) => need.push(id));
  }
  return { need, have };
}
