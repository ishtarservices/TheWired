import { describe, it, expect } from "vitest";
import {
  parseDMWire,
  conversationIdOf,
  textRumorTags,
  fileRumorTags,
  reactionRumorTags,
  controlRumorTags,
  receiptRumorTags,
  typingRumorTags,
  defaultExpirationFor,
} from "../dmWire";
import type { UnwrappedDM } from "../../crypto/giftWrap";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const R1 = "1".repeat(64);
const R2 = "2".repeat(64);

function dm(over: Partial<UnwrappedDM>): UnwrappedDM {
  return {
    sender: A,
    content: "",
    tags: [["p", B]],
    createdAt: 1_700_000_000,
    wrapId: "f".repeat(64),
    rumorId: "e".repeat(64),
    kind: 14,
    ...over,
  };
}

describe("conversationIdOf", () => {
  it("1:1 from either side resolves to the peer", () => {
    expect(conversationIdOf({ sender: A, tags: [["p", B]] }, B).conversationId).toBe(A);
    expect(conversationIdOf({ sender: A, tags: [["p", B]] }, A).conversationId).toBe(B);
  });
  it("note to self resolves to self", () => {
    expect(conversationIdOf({ sender: A, tags: [["p", A]] }, A).conversationId).toBe(A);
  });
  it("3+ participants → sorted participant key; explicit g wins", () => {
    const r = conversationIdOf({ sender: C, tags: [["p", A], ["p", B]] }, A);
    expect(r.isRoom).toBe(true);
    expect(r.conversationId).toBe([A, B, C].join(","));
    const g = conversationIdOf({ sender: C, tags: [["p", A], ["p", B], ["g", "room-1"]] }, A);
    expect(g.conversationId).toBe("room-1");
  });
});

describe("parseDMWire — spec forms", () => {
  it("plain text with an e reply and a q quote", () => {
    const ev = parseDMWire(dm({ content: "hi", tags: [["p", B], ["e", R1, ""], ["q", R2], ["emoji", "x", "https://e/x.png"]] }), B);
    expect(ev.type).toBe("text");
    if (ev.type !== "text") return;
    expect(ev.replyTo).toBe(R1);
    expect(ev.quote).toBe(R2);
    expect(ev.legacy).toBe(false);
    expect(ev.emojiTags).toHaveLength(1);
    expect(ev.conversationId).toBe(A);
  });

  it("kind 7 reaction: last e tag is the target; empty content → +", () => {
    const ev = parseDMWire(dm({ kind: 7, content: "", tags: [["p", B], ["e", R2], ["e", R1], ["k", "14"]] }), B);
    expect(ev.type).toBe("reaction");
    if (ev.type !== "reaction") return;
    expect(ev.targetRumorId).toBe(R1);
    expect(ev.emoji).toBe("+");
    expect(ev.legacy).toBe(false);
  });

  it("kind 15 file with all required tags", () => {
    const tags = [["p", B], ...fileRumorTags({ fileType: "image/png", key: "a".repeat(64), nonce: "b".repeat(24), x: R1, ox: R2, size: 10, dim: "2x2" })];
    const ev = parseDMWire(dm({ kind: 15, content: "https://blossom.example/x.bin", tags }), B);
    expect(ev.type).toBe("file");
    if (ev.type !== "file") return;
    expect(ev.file).toMatchObject({ url: "https://blossom.example/x.bin", fileType: "image/png", x: R1, ox: R2, size: 10, dim: "2x2" });
  });

  it("kind 15 without a key is unknown (never rendered)", () => {
    const ev = parseDMWire(dm({ kind: 15, content: "https://x/y", tags: [["p", B], ["file-type", "image/png"], ["encryption-algorithm", "aes-gcm"]] }), B);
    expect(ev.type).toBe("unknown");
  });

  it("typing and receipts", () => {
    expect(parseDMWire(dm({ kind: 20014 }), B).type).toBe("typing");
    const r = parseDMWire(dm({ kind: 20015, tags: [["p", B], ["status", "read"], ["e", R1], ["e", R2]] }), B);
    expect(r.type).toBe("receipt");
    if (r.type !== "receipt") return;
    expect(r.status).toBe("read");
    expect(r.rumorIds).toEqual([R1, R2]);
    expect(parseDMWire(dm({ kind: 20015, tags: [["p", B], ["e", R1]] }), B).type).toBe("unknown");
  });

  it("unsupported kinds are unknown", () => {
    expect(parseDMWire(dm({ kind: 1 }), B).type).toBe("unknown");
  });
});

describe("parseDMWire — legacy forms still read", () => {
  it("q-only reply anchor is read as a reply and flagged legacy", () => {
    const ev = parseDMWire(dm({ content: "re", tags: [["p", B], ["q", R1]] }), B);
    if (ev.type !== "text") throw new Error("expected text");
    expect(ev.replyTo).toBe(R1);
    expect(ev.legacy).toBe(true);
  });

  it("typed dm_reaction / dm_reaction_remove", () => {
    const add = parseDMWire(dm({ content: "🔥", tags: [["p", B], ["type", "dm_reaction"], ["e", R1]] }), B);
    expect(add).toMatchObject({ type: "reaction", targetRumorId: R1, emoji: "🔥", legacy: true });
    const rm = parseDMWire(dm({ content: "🔥", tags: [["p", B], ["type", "dm_reaction_remove"], ["e", R1]] }), B);
    expect(rm).toMatchObject({ type: "reaction_remove", targetRumorId: R1, emoji: "🔥" });
  });

  it("edit / delete / friend / call control rumors", () => {
    expect(parseDMWire(dm({ content: "fixed", tags: [["p", B], ["type", "dm_edit"], ["e", R1]] }), B)).toMatchObject({ type: "edit", targetRumorId: R1, content: "fixed" });
    expect(parseDMWire(dm({ tags: [["p", B], ["type", "dm_delete"], ["e", R1]] }), B)).toMatchObject({ type: "delete", targetRumorId: R1 });
    expect(parseDMWire(dm({ content: "hey", tags: [["p", B], ["type", "friend_request"]] }), B)).toMatchObject({ type: "friend_request", content: "hey" });
    expect(parseDMWire(dm({ content: "{}", tags: [["p", B], ["type", "call_invite"]] }), B)).toMatchObject({ type: "call_invite" });
    expect(parseDMWire(dm({ tags: [["p", B], ["type", "dm_edit"]] }), B).type).toBe("unknown");
  });

  it("an unknown type from a newer client is dropped, not rendered", () => {
    expect(parseDMWire(dm({ content: "??", tags: [["p", B], ["type", "dm_future"]] }), B).type).toBe("unknown");
  });
});

describe("builders", () => {
  it("textRumorTags writes e for replies, q for quotes", () => {
    expect(textRumorTags({ replyTo: R1 })).toEqual([["e", R1, ""]]);
    expect(textRumorTags({ replyTo: R1, replyRelayHint: "wss://r", quote: R2, subject: "s", roomId: "g1" })).toEqual([
      ["e", R1, "wss://r"], ["q", R2], ["subject", "s"], ["g", "g1"],
    ]);
  });
  it("reactionRumorTags carries e + k", () => {
    expect(reactionRumorTags({ targetRumorId: R1 })).toEqual([["e", R1], ["k", "14"]]);
  });
  it("controlRumorTags requires a target for edit/delete/un-react", () => {
    expect(controlRumorTags("dm_edit", { targetRumorId: R1 })).toEqual([["type", "dm_edit"], ["e", R1]]);
    expect(() => controlRumorTags("dm_delete")).toThrow();
    expect(controlRumorTags("friend_request")).toEqual([["type", "friend_request"]]);
  });
  it("receiptRumorTags dedups + caps ids; typing carries only g", () => {
    expect(receiptRumorTags("delivered", [R1, R1, R2])).toEqual([["status", "delivered"], ["e", R1], ["e", R2]]);
    expect(() => receiptRumorTags("read", [])).toThrow();
    expect(typingRumorTags()).toEqual([]);
    expect(typingRumorTags({ roomId: "g" })).toEqual([["g", "g"]]);
  });
  it("defaultExpirationFor follows the §5 table", () => {
    expect(defaultExpirationFor("typing", 100)).toBe(130);
    expect(defaultExpirationFor("receipt", 100)).toBe(100 + 7 * 86400);
    expect(defaultExpirationFor("call", 100)).toBe(220);
    expect(defaultExpirationFor("message", 100)).toBeUndefined();
    expect(defaultExpirationFor("message", 100, 3600)).toBe(3700);
  });
});
