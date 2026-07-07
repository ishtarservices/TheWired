import {
  assertSafeLnurlUrl,
  decodeLnurl,
  encodeLnurl,
  lud16ToUrl,
  resolveZapEndpoint,
} from "../lnurl";

describe("assertSafeLnurlUrl", () => {
  it("accepts public https URLs", () => {
    expect(assertSafeLnurlUrl("https://getalby.com/.well-known/lnurlp/alice")).toContain(
      "getalby.com",
    );
  });

  it("rejects http, private hosts, onion and junk", () => {
    for (const bad of [
      "http://getalby.com/x",
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://192.168.0.1/x",
      "https://169.254.169.254/latest/meta-data",
      "https://router.local/x",
      "https://pay.onion/x",
      "not a url",
    ]) {
      expect(() => assertSafeLnurlUrl(bad)).toThrow();
    }
  });
});

describe("lud16 + bech32 lnurl", () => {
  it("maps a lightning address to its well-known URL", () => {
    expect(lud16ToUrl("alice@getalby.com")).toBe(
      "https://getalby.com/.well-known/lnurlp/alice",
    );
    expect(lud16ToUrl("nope")).toBeNull();
    expect(lud16ToUrl("@domain")).toBeNull();
  });

  it("bech32 round-trips", () => {
    const url = "https://getalby.com/.well-known/lnurlp/alice";
    const encoded = encodeLnurl(url);
    expect(encoded.startsWith("LNURL1")).toBe(true);
    expect(decodeLnurl(encoded)).toBe(url);
  });
});

describe("resolveZapEndpoint", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetch(payload: unknown) {
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => payload,
    })) as unknown as typeof fetch;
  }

  it("resolves a nostr-capable endpoint and validates the callback", async () => {
    mockFetch({
      tag: "payRequest",
      callback: "https://pay.example.com/cb",
      minSendable: 1000,
      maxSendable: 100_000_000,
      allowsNostr: true,
      nostrPubkey: "a".repeat(64),
      commentAllowed: 120,
    });
    const endpoint = await resolveZapEndpoint({ lud16: "alice@example.com" });
    expect(endpoint.allowsNostr).toBe(true);
    expect(endpoint.nostrPubkey).toBe("a".repeat(64));
    expect(endpoint.callback).toBe("https://pay.example.com/cb");
  });

  it("rejects a poisoned (private-host) callback at resolve time", async () => {
    mockFetch({
      tag: "payRequest",
      callback: "https://169.254.169.254/latest",
      allowsNostr: true,
      nostrPubkey: "a".repeat(64),
    });
    await expect(resolveZapEndpoint({ lud16: "alice@example.com" })).rejects.toThrow(
      /private-network/,
    );
  });

  it("treats a bogus nostrPubkey as non-zap (plain LNURL)", async () => {
    mockFetch({
      tag: "payRequest",
      callback: "https://pay.example.com/cb",
      allowsNostr: true,
      nostrPubkey: "not-hex",
    });
    const endpoint = await resolveZapEndpoint({ lud16: "alice@example.com" });
    expect(endpoint.allowsNostr).toBe(false);
    expect(endpoint.nostrPubkey).toBeUndefined();
  });

  it("rejects non-payRequest responses", async () => {
    mockFetch({ tag: "withdrawRequest", callback: "https://x.example/cb" });
    await expect(resolveZapEndpoint({ lud16: "alice@example.com" })).rejects.toThrow(
      /Invalid LNURL-pay/,
    );
  });
});
