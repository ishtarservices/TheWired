import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encodeLnurl,
  decodeLnurl,
  lud16ToUrl,
  resolveZapEndpoint,
  requestZapInvoice,
  requestPlainInvoice,
} from "../lnurl";
import type { NostrEvent } from "../../../types/nostr";

describe("lnurl bech32 encoding", () => {
  it("round-trips a URL through the lnurl bech32 codec", () => {
    const url = "https://walletofsatoshi.com/.well-known/lnurlp/alice";
    const encoded = encodeLnurl(url);
    expect(encoded.toLowerCase().startsWith("lnurl1")).toBe(true);
    // uppercase per LNURL convention
    expect(encoded).toBe(encoded.toUpperCase());
    expect(decodeLnurl(encoded)).toBe(url);
  });

  it("decodes the NIP-57 example lnurl to an https URL", () => {
    const lnurl =
      "lnurl1dp68gurn8ghj7um5v93kketj9ehx2amn9uh8wetvdskkkmn0wahz7mrww4excup0dajx2mrv92x9xp";
    expect(decodeLnurl(lnurl).startsWith("https://")).toBe(true);
  });
});

describe("lud16ToUrl", () => {
  it("maps name@domain to the .well-known/lnurlp URL", () => {
    expect(lud16ToUrl("alice@example.com")).toBe(
      "https://example.com/.well-known/lnurlp/alice",
    );
  });
  it("returns null for malformed addresses", () => {
    expect(lud16ToUrl("noatsign")).toBeNull();
    expect(lud16ToUrl("@example.com")).toBeNull();
    expect(lud16ToUrl("alice@")).toBeNull();
  });
  it("uses http for .onion domains", () => {
    expect(lud16ToUrl("a@hidden.onion")).toBe(
      "http://hidden.onion/.well-known/lnurlp/a",
    );
  });
});

describe("resolveZapEndpoint + invoice requests", () => {
  const mockFetch = vi.fn();
  const okJson = (body: unknown) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a zap-capable endpoint and computes the lnurl tag", async () => {
    mockFetch.mockReturnValueOnce(
      okJson({
        tag: "payRequest",
        callback: "https://example.com/cb",
        minSendable: 1000,
        maxSendable: 100_000_000,
        allowsNostr: true,
        nostrPubkey: "a".repeat(64),
      }),
    );
    const ep = await resolveZapEndpoint({ lud16: "alice@example.com" });
    expect(ep.callback).toBe("https://example.com/cb");
    expect(ep.allowsNostr).toBe(true);
    expect(ep.nostrPubkey).toBe("a".repeat(64));
    expect(ep.lnurlBech32.toLowerCase().startsWith("lnurl1")).toBe(true);
  });

  it("marks allowsNostr false when nostrPubkey is missing", async () => {
    mockFetch.mockReturnValueOnce(
      okJson({
        tag: "payRequest",
        callback: "https://x/cb",
        minSendable: 1,
        maxSendable: 2,
        allowsNostr: true,
      }),
    );
    const ep = await resolveZapEndpoint({ lud16: "a@b.com" });
    expect(ep.allowsNostr).toBe(false);
  });

  it("throws on a non-payRequest response", async () => {
    mockFetch.mockReturnValueOnce(okJson({ tag: "withdrawRequest" }));
    await expect(resolveZapEndpoint({ lud16: "a@b.com" })).rejects.toThrow();
  });

  it("throws when the recipient has no lightning address", async () => {
    await expect(resolveZapEndpoint({})).rejects.toThrow(/Lightning address/);
  });

  it("requestZapInvoice attaches amount, nostr and lnurl params", async () => {
    mockFetch.mockReturnValueOnce(okJson({ pr: "lnbc10u1xxx" }));
    const zr: NostrEvent = {
      id: "id",
      pubkey: "pk",
      created_at: 1,
      kind: 9734,
      tags: [],
      content: "",
      sig: "s",
    };
    const inv = await requestZapInvoice({
      callback: "https://x/cb",
      amountMsat: 1_000_000,
      zapRequest: zr,
      lnurlBech32: "LNURL1ABC",
    });
    expect(inv).toBe("lnbc10u1xxx");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("amount=1000000");
    expect(calledUrl).toContain("nostr=");
    expect(calledUrl).toContain("lnurl=LNURL1ABC");
  });

  it("requestPlainInvoice throws on an LNURL error status", async () => {
    mockFetch.mockReturnValueOnce(okJson({ status: "ERROR", reason: "nope" }));
    await expect(requestPlainInvoice("https://x/cb", 1000)).rejects.toThrow("nope");
  });
});
