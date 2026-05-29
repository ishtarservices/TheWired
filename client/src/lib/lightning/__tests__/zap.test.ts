import { describe, it, expect, vi } from "vitest";

// Isolate zap.ts from its heavy / side-effecting imports.
vi.mock("../../nostr/loginFlow", () => ({
  getSigner: () => null,
  getSignerTimeoutMs: () => 12_000,
}));
vi.mock("../../nostr/relayManager", () => ({
  relayManager: {
    subscribe: vi.fn(() => "sub"),
    closeSubscription: vi.fn(),
    getWriteRelays: () => [],
  },
}));
vi.mock("../../nostr/nip65", () => ({ fetchRelayList: vi.fn(() => "sub") }));

import { getSatoshisAmountFromBolt11 } from "nostr-tools/nip57";
import {
  validateZapReceipt,
  buildAndSignZapRequest,
  type ZapValidation,
} from "../zap";
import type { NostrEvent } from "../../../types/nostr";

// 10 micro-BTC = 1000 sats; padded past the 50-char HRP window the parser reads.
const BOLT11 = "lnbc10u1p3unwfusp5t9r3yymhpfqculx78u027lxspgxcr2n2987";
const SATS = getSatoshisAmountFromBolt11(BOLT11);
const MSAT = SATS * 1000;
const SERVER_PK = "5".repeat(64);

function receipt(over: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "r",
    pubkey: SERVER_PK,
    created_at: 1,
    kind: 9735,
    content: "",
    sig: "x",
    tags: [
      ["bolt11", BOLT11],
      ["lnurl", "LNURL1ABC"],
    ],
    ...over,
  };
}

describe("validateZapReceipt (NIP-57 Appendix F)", () => {
  // Guard: the bolt11 vector must parse, or the amount checks below are meaningless.
  it("uses a bolt11 vector that parses to a positive amount", () => {
    expect(SATS).toBeGreaterThan(0);
  });

  const v: ZapValidation = {
    nostrPubkey: SERVER_PK,
    lnurlBech32: "LNURL1ABC",
    expectedMsat: MSAT,
  };

  it("accepts a valid receipt", () => {
    expect(validateZapReceipt(receipt(), v)).toBe(true);
  });

  it("rejects a spoofed receipt pubkey", () => {
    expect(validateZapReceipt(receipt({ pubkey: "e".repeat(64) }), v)).toBe(false);
  });

  it("rejects an amount mismatch (the msats x1000 guard)", () => {
    expect(validateZapReceipt(receipt(), { ...v, expectedMsat: MSAT + 1000 })).toBe(
      false,
    );
  });

  it("rejects an lnurl-tag mismatch", () => {
    expect(validateZapReceipt(receipt(), { ...v, lnurlBech32: "LNURL1ZZZ" })).toBe(
      false,
    );
  });

  it("rejects a receipt with no bolt11 tag", () => {
    expect(validateZapReceipt(receipt({ tags: [["lnurl", "LNURL1ABC"]] }), v)).toBe(
      false,
    );
  });
});

describe("buildAndSignZapRequest (anonymous)", () => {
  it("builds a signed kind:9734 with amount/p/relays/lnurl tags", async () => {
    const ev = await buildAndSignZapRequest({
      recipientPubkey: "b".repeat(64),
      amountMsat: 21_000,
      relays: ["wss://r1.example"],
      comment: "gm",
      lnurlBech32: "LNURL1ABC",
      anonymous: true,
    });
    expect(ev.kind).toBe(9734);
    expect(ev.content).toBe("gm");
    expect(ev.sig).toBeTruthy();
    expect(ev.id).toBeTruthy();

    const tag = (n: string) => ev.tags.find((t) => t[0] === n);
    expect(tag("amount")?.[1]).toBe("21000"); // millisats, stringified
    expect(tag("p")?.[1]).toBe("b".repeat(64));
    expect(tag("lnurl")?.[1]).toBe("LNURL1ABC");
    expect(tag("relays")).toContain("wss://r1.example");
  });

  it("adds e/k tags when zapping a specific event", async () => {
    const target: NostrEvent = {
      id: "f".repeat(64),
      pubkey: "b".repeat(64),
      created_at: 1,
      kind: 1,
      tags: [],
      content: "zap me",
      sig: "s",
    };
    const ev = await buildAndSignZapRequest({
      recipientPubkey: target.pubkey,
      amountMsat: 1000,
      relays: ["wss://r"],
      event: target,
      lnurlBech32: "LNURL1ABC",
      anonymous: true,
    });
    expect(ev.tags.find((t) => t[0] === "e")?.[1]).toBe(target.id);
    expect(ev.tags.find((t) => t[0] === "k")?.[1]).toBe("1");
  });
});
