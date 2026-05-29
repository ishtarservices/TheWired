import { describe, it, expect, vi } from "vitest";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { bytesToHex } from "@noble/hashes/utils";

// Hoisted mock handle so the (hoisted) vi.mock factory can reference it.
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("nostr-tools/relay", () => ({
  Relay: { connect: mocks.connect },
}));

import { parseNwcUri, NwcClient } from "../nwcClient";

describe("parseNwcUri", () => {
  it("parses pubkey, relay, secret and lud16 from the URI", () => {
    const uri =
      "nostr+walletconnect://b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4?relay=wss%3A%2F%2Frelay.damus.io&secret=71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c&lud16=alice%40example.com";
    const p = parseNwcUri(uri);
    expect(p.walletPubkey).toBe(
      "b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4",
    );
    expect(p.relayUrl).toBe("wss://relay.damus.io");
    expect(p.secretHex).toBe(
      "71a8c14c1407c113601079c4302dab36460f0ccd0ad506f1f2dc73b5100e4f3c",
    );
    expect(p.lud16).toBe("alice@example.com");
  });
});

/**
 * Builds a fake relay that plays the wallet-service role: it answers the 13194
 * info query with EOSE (→ nip44_v2 default) and, on publish of a 23194 request,
 * encrypts a 23195 response with the wallet's side of the conversation key and
 * delivers it to the request subscription (correlated by `e` tag).
 */
function makeWalletRelay(opts: {
  walletSk: Uint8Array;
  walletPub: string;
  clientPub: string;
  response: unknown;
}) {
  let respHandler: ((evt: unknown) => void) | null = null;
  return {
    connected: true,
    subscribe(filters: { kinds?: number[] }[], params: { onevent: (e: unknown) => void; oneose?: () => void }) {
      const kinds = filters[0]?.kinds ?? [];
      if (kinds.includes(13194)) {
        setTimeout(() => params.oneose?.(), 0);
      } else if (kinds.includes(23195)) {
        respHandler = params.onevent;
      }
      return { close() {} };
    },
    async publish(event: { id: string }) {
      const convKey = nip44.v2.utils.getConversationKey(opts.walletSk, opts.clientPub);
      const content = nip44.v2.encrypt(JSON.stringify(opts.response), convKey);
      const resp = finalizeEvent(
        {
          kind: 23195,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["p", opts.clientPub],
            ["e", event.id],
          ],
          content,
        },
        opts.walletSk,
      );
      setTimeout(() => respHandler?.(resp), 0);
      return "ok";
    },
    close() {},
  };
}

describe("NwcClient request/response (mock relay)", () => {
  function setup(response: unknown) {
    const walletSk = generateSecretKey();
    const walletPub = getPublicKey(walletSk);
    const clientSk = generateSecretKey();
    const clientPub = getPublicKey(clientSk);
    mocks.connect.mockResolvedValue(
      makeWalletRelay({ walletSk, walletPub, clientPub, response }),
    );
    const client = new NwcClient({
      walletPubkey: walletPub,
      relayUrl: "wss://nwc.example",
      secretHex: bytesToHex(clientSk),
    });
    return client;
  }

  it("pays an invoice and returns the decrypted preimage", async () => {
    const client = setup({
      result_type: "pay_invoice",
      result: { preimage: "deadbeef", fees_paid: 1 },
    });
    const res = await client.payInvoice("lnbc10u1xxx");
    expect(res.preimage).toBe("deadbeef");
  });

  it("returns a decrypted balance", async () => {
    const client = setup({ result_type: "get_balance", result: { balance: 42_000 } });
    const res = await client.getBalance();
    expect(res.balance).toBe(42_000);
  });

  it("rejects when the wallet replies with an error", async () => {
    const client = setup({
      result_type: "pay_invoice",
      error: { code: "INSUFFICIENT_BALANCE", message: "not enough sats" },
    });
    await expect(client.payInvoice("lnbc1")).rejects.toThrow("not enough sats");
  });

  it("rejects fast (no unhandled rejection) when relay.publish fails — wallet offline", async () => {
    // Regression: a publish-error used to orphan the response promise, leaving the
    // 30s timeout to fire reject on it later → unhandled. Now publish errors funnel
    // through the same `finish`, settling the promise immediately.
    const walletSk = generateSecretKey();
    const walletPub = getPublicKey(walletSk);
    const clientSk = generateSecretKey();
    mocks.connect.mockResolvedValue({
      connected: true,
      onclose: null,
      subscribe(
        filters: { kinds?: number[] }[],
        params: { onevent: (e: unknown) => void; oneose?: () => void },
      ) {
        const kinds = filters[0]?.kinds ?? [];
        if (kinds.includes(13194)) setTimeout(() => params.oneose?.(), 0);
        return { close() {} };
      },
      publish: () => Promise.reject(new Error("relay offline")),
      close() {},
    });
    const client = new NwcClient({
      walletPubkey: walletPub,
      relayUrl: "wss://offline.example",
      secretHex: bytesToHex(clientSk),
    });
    await expect(client.payInvoice("lnbc1")).rejects.toThrow(
      /relay offline|Failed to send/,
    );
  });
});
