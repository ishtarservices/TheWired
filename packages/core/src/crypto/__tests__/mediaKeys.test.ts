import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import {
  deriveCallSenderKey,
  callSenderKeyInfo,
  MEDIA_KEY_SALT,
  MEDIA_KEY_BYTES,
} from "../mediaKeys";

const SECRET = "01".repeat(32);
const ROOM = "ab".repeat(32);
const ROOM2 = "cd".repeat(32);
const ALICE = "aa".repeat(32);
const BOB = "bb".repeat(32);

// Vectors computed independently with @noble/hashes hkdf(sha256, ikm, salt,
// info, 32) — see docs/E2EE_CALLS.md. Any change here is a wire break for
// every client (desktop AND mobile derive these).
const VECTORS = {
  alice: "cb57d35acb77053ec38799703026fdb686c90b720e91775cb55ac47818e5ad70",
  bob: "1688503065e15468eeb9395eb60d0e82ddf9b92f12219dc3b2ff250302c918fd",
  aliceRoom2: "53c63160bb156aa6108d2610ad52fa90a4832b4e39215d7eb721f1fe9a03f803",
};

describe("deriveCallSenderKey", () => {
  it("matches the pinned HKDF-SHA256 vectors", () => {
    expect(bytesToHex(deriveCallSenderKey(SECRET, ROOM, ALICE))).toBe(VECTORS.alice);
    expect(bytesToHex(deriveCallSenderKey(SECRET, ROOM, BOB))).toBe(VECTORS.bob);
    expect(bytesToHex(deriveCallSenderKey(SECRET, ROOM2, ALICE))).toBe(VECTORS.aliceRoom2);
  });

  it("yields 32 bytes and is deterministic", () => {
    const a = deriveCallSenderKey(SECRET, ROOM, ALICE);
    const b = deriveCallSenderKey(SECRET, ROOM, ALICE);
    expect(a).toHaveLength(MEDIA_KEY_BYTES);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("separates senders and rooms (per-sender keys, RFC 9605 §4.4.1)", () => {
    const alice = bytesToHex(deriveCallSenderKey(SECRET, ROOM, ALICE));
    const bob = bytesToHex(deriveCallSenderKey(SECRET, ROOM, BOB));
    const aliceElsewhere = bytesToHex(deriveCallSenderKey(SECRET, ROOM2, ALICE));
    expect(alice).not.toBe(bob);
    expect(alice).not.toBe(aliceElsewhere);
  });

  it("changes entirely with the secret", () => {
    const other = "02".repeat(32);
    expect(bytesToHex(deriveCallSenderKey(other, ROOM, ALICE))).not.toBe(VECTORS.alice);
  });

  it("rejects malformed inputs instead of deriving from garbage", () => {
    expect(() => deriveCallSenderKey("01".repeat(31), ROOM, ALICE)).toThrow(/roomSecretKey/);
    expect(() => deriveCallSenderKey(SECRET, "nope", ALICE)).toThrow(/roomId/);
    expect(() => deriveCallSenderKey(SECRET, ROOM, ALICE.toUpperCase())).toThrow(/senderPubkey/);
  });

  it("binds the info string to room and sender under the v1 salt", () => {
    expect(MEDIA_KEY_SALT).toBe("thewired-e2ee-v1");
    expect(callSenderKeyInfo(ROOM, ALICE)).toBe(`lk:${ROOM}:${ALICE}`);
  });
});
