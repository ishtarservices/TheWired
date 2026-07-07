import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { getConversationKey, encrypt, decrypt } from "nostr-tools/nip44";
import { finalizeEvent } from "nostr-tools/pure";
import { getSatoshisAmountFromBolt11 } from "nostr-tools/nip57";
import type { NostrEvent } from "@thewired/shared-types";

import { LocalNsecSigner } from "@/auth/LocalNsecSigner";
import type { PlatformAdapters, WebSocketLike } from "@/core/adapters";
import { sendZap } from "../zapService";

// The BOLT11 spec's 2.5mBTC (250,000 sats) example invoice — a stable fixture
// for the amount-tamper guard (only the hrp amount is parsed).
const INVOICE_250K_SATS =
  "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";

const walletSecret = generateSecretKey();
const walletPubkey = getPublicKey(walletSecret);
const connSecret = generateSecretKey();
const NWC_URI = `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(
  "wss://relay.wallet.example",
)}&secret=${bytesToHex(connSecret)}`;

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
  frames(): unknown[][] {
    return this.sent.map((raw) => JSON.parse(raw));
  }
}

function makeAdapters(sockets: FakeSocket[]): PlatformAdapters {
  return {
    ws: {
      create() {
        const s = new FakeSocket();
        sockets.push(s);
        setTimeout(() => s.open(), 0);
        return s;
      },
    },
    verifier: { verify: async () => true },
    storage: null as never,
    signer: new LocalNsecSigner(generateSecretKey()),
    secretStore: {
      getSecret: async (key: string) => (key === "wallet.nwc" ? NWC_URI : null),
      setSecret: async () => {},
      deleteSecret: async () => {},
    },
    http: null as never,
    push: null as never,
  };
}

function mockLnurlServer(invoice: string) {
  const calls: string[] = [];
  globalThis.fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/.well-known/lnurlp/")) {
      return {
        ok: true,
        json: async () => ({
          tag: "payRequest",
          callback: "https://pay.example.com/cb",
          minSendable: 1000,
          maxSendable: 100_000_000_000,
          allowsNostr: true,
          nostrPubkey: "a".repeat(64),
        }),
      };
    }
    return { ok: true, json: async () => ({ pr: invoice }) };
  }) as unknown as typeof fetch;
  return calls;
}

describe("sendZap", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("sanity: the fixture invoice decodes to 250k sats", () => {
    expect(getSatoshisAmountFromBolt11(INVOICE_250K_SATS)).toBe(250_000);
  });

  it("refuses to pay when the invoice amount doesn't match the request (#10 guard)", async () => {
    const sockets: FakeSocket[] = [];
    mockLnurlServer(INVOICE_250K_SATS);
    await expect(
      sendZap({
        adapters: makeAdapters(sockets),
        recipientPubkey: "b".repeat(64),
        amountSats: 21, // ≠ 250,000
        lud16: "alice@example.com",
        receiptRelays: ["wss://relay.example"],
      }),
    ).rejects.toThrow(/mismatch.*nothing was paid/i);
    // No wallet socket was ever opened — the guard fires before payment.
    expect(sockets).toHaveLength(0);
  });

  it("signs a 9734, requests the invoice, and pays the matching amount via NWC", async () => {
    const sockets: FakeSocket[] = [];
    const calls = mockLnurlServer(INVOICE_250K_SATS);

    const zap = sendZap({
      adapters: makeAdapters(sockets),
      recipientPubkey: "b".repeat(64),
      amountSats: 250_000,
      comment: "great post",
      lud16: "alice@example.com",
      receiptRelays: ["wss://relay.example"],
    });

    // The LNURL callback got the signed zap request.
    await new Promise((r) => setTimeout(r, 30));
    const invoiceCall = calls.find((u) => u.includes("pay.example.com/cb"))!;
    expect(invoiceCall).toContain("amount=250000000");
    const nostrParam = decodeURIComponent(/nostr=([^&]+)/.exec(invoiceCall)![1]);
    const zapRequest = JSON.parse(nostrParam) as NostrEvent;
    expect(zapRequest.kind).toBe(9734);
    expect(zapRequest.tags.find((t) => t[0] === "amount")?.[1]).toBe("250000000");

    // Wallet side over the fake socket: info EOSE → decrypt 23194 → 23195 ok.
    const socket = sockets[0];
    const infoReq = socket.frames().find((f) => f[0] === "REQ")!;
    socket.message(["EOSE", infoReq[1]]);
    await new Promise((r) => setTimeout(r, 30));
    const request = socket.frames().find((f) => f[0] === "EVENT")![1] as NostrEvent;
    const convKey = getConversationKey(walletSecret, getPublicKey(hexToBytes(bytesToHex(connSecret))));
    const payload = JSON.parse(decrypt(request.content, convKey)) as {
      method: string;
      params: { invoice: string };
    };
    expect(payload.method).toBe("pay_invoice");
    expect(payload.params.invoice).toBe(INVOICE_250K_SATS);

    const response = finalizeEvent(
      {
        kind: 23195,
        created_at: 1_700_000_001,
        tags: [["e", request.id]],
        content: encrypt(JSON.stringify({ result: { preimage: "abcd" } }), convKey),
      },
      walletSecret,
    );
    socket.message(["EVENT", socket.frames().filter((f) => f[0] === "REQ")[1][1], response]);

    await expect(zap).resolves.toMatchObject({ preimage: "abcd", hasReceipt: true });
    // Idle-close after payment.
    expect(socket.readyState).toBe(3);
  });
});
