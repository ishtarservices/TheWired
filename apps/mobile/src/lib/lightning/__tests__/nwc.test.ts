import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { getConversationKey, encrypt, decrypt } from "nostr-tools/nip44";
import { finalizeEvent } from "nostr-tools/pure";
import type { NostrEvent } from "@thewired/shared-types";

import type { WebSocketFactory, WebSocketLike } from "@/core/adapters";
import { NwcSession, parseNwcUri } from "../nwc";

const walletSecret = generateSecretKey();
const walletPubkey = getPublicKey(walletSecret);
const connSecret = generateSecretKey();
const connSecretHex = bytesToHex(connSecret);

const URI = `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent(
  "wss://relay.wallet.example",
)}&secret=${connSecretHex}&lud16=me%40wallet.example`;

describe("parseNwcUri", () => {
  it("parses a well-formed URI", () => {
    const parsed = parseNwcUri(URI);
    expect(parsed.walletPubkey).toBe(walletPubkey);
    expect(parsed.relayUrl).toBe("wss://relay.wallet.example");
    expect(parsed.secretHex).toBe(connSecretHex);
    expect(parsed.lud16).toBe("me@wallet.example");
  });

  it("rejects junk, bad keys and private relays", () => {
    expect(() => parseNwcUri("https://not-a-wallet")).toThrow();
    expect(() =>
      parseNwcUri(`nostr+walletconnect://xyz?relay=wss%3A%2F%2Fr.example&secret=${connSecretHex}`),
    ).toThrow();
    expect(() =>
      parseNwcUri(
        `nostr+walletconnect://${walletPubkey}?relay=${encodeURIComponent("ws://127.0.0.1:4869")}&secret=${connSecretHex}`,
      ),
    ).toThrow(/public wss/);
  });
});

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

describe("NwcSession.payInvoice", () => {
  it("publishes an encrypted 23194 and resolves the decrypted 23195 result", async () => {
    const sockets: FakeSocket[] = [];
    const wsFactory: WebSocketFactory = {
      create() {
        const s = new FakeSocket();
        sockets.push(s);
        // auto-open next tick so connect() resolves
        setTimeout(() => s.open(), 0);
        return s;
      },
    };

    const session = new NwcSession(parseNwcUri(URI), wsFactory);
    const paying = session.payInvoice("lnbc21fake", 21_000);

    // Wallet side: answer the info REQ (advertise nip44_v2).
    await new Promise((r) => setTimeout(r, 20));
    const socket = sockets[0];
    const infoReq = socket.frames().find((f) => f[0] === "REQ")!;
    const infoEvent = finalizeEvent(
      {
        kind: 13194,
        created_at: 1_700_000_000,
        tags: [["encryption", "nip44_v2 nip04"]],
        content: "pay_invoice get_balance get_info",
      },
      walletSecret,
    );
    socket.message(["EVENT", infoReq[1], infoEvent]);

    // The 23194 request lands; decrypt it wallet-side and check the payload.
    await new Promise((r) => setTimeout(r, 20));
    const evtFrame = socket.frames().find((f) => f[0] === "EVENT")!;
    const request = evtFrame[1] as NostrEvent;
    expect(request.kind).toBe(23194);
    const convKey = getConversationKey(walletSecret, request.pubkey);
    const payload = JSON.parse(decrypt(request.content, convKey)) as {
      method: string;
      params: { invoice: string; amount: number };
    };
    expect(payload.method).toBe("pay_invoice");
    expect(payload.params.invoice).toBe("lnbc21fake");
    expect(payload.params.amount).toBe(21_000);

    // Respond with an encrypted 23195 result correlated by e-tag.
    const response = finalizeEvent(
      {
        kind: 23195,
        created_at: 1_700_000_001,
        tags: [
          ["p", request.pubkey],
          ["e", request.id],
        ],
        content: encrypt(JSON.stringify({ result: { preimage: "f00d" } }), convKey),
      },
      walletSecret,
    );
    socket.message(["EVENT", socket.frames().filter((f) => f[0] === "REQ")[1][1], response]);

    await expect(paying).resolves.toEqual({ preimage: "f00d" });

    // Idle-close: the wallet socket must not linger.
    session.close();
    expect(socket.readyState).toBe(3);
  });

  it("rejects on a wallet error response", async () => {
    const sockets: FakeSocket[] = [];
    const wsFactory: WebSocketFactory = {
      create() {
        const s = new FakeSocket();
        sockets.push(s);
        setTimeout(() => s.open(), 0);
        return s;
      },
    };
    const session = new NwcSession(parseNwcUri(URI), wsFactory);
    const paying = session.payInvoice("lnbc21fake");

    await new Promise((r) => setTimeout(r, 20));
    const socket = sockets[0];
    const infoReq = socket.frames().find((f) => f[0] === "REQ")!;
    socket.message(["EOSE", infoReq[1]]); // no info event → defaults to nip44_v2

    await new Promise((r) => setTimeout(r, 20));
    const request = socket.frames().find((f) => f[0] === "EVENT")![1] as NostrEvent;
    const convKey = getConversationKey(hexToBytes(connSecretHex), walletPubkey);
    void convKey;
    const walletConv = getConversationKey(walletSecret, request.pubkey);
    const response = finalizeEvent(
      {
        kind: 23195,
        created_at: 1_700_000_001,
        tags: [["e", request.id]],
        content: encrypt(
          JSON.stringify({ error: { code: "INSUFFICIENT_BALANCE", message: "not enough sats" } }),
          walletConv,
        ),
      },
      walletSecret,
    );
    socket.message(["EVENT", socket.frames().filter((f) => f[0] === "REQ")[1][1], response]);

    await expect(paying).rejects.toThrow(/not enough sats/);
    session.close();
  });
});
