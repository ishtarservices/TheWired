// NIP-47 Nostr Wallet Connect — mobile port of the desktop nwcClient,
// rebuilt over the WebSocketFactory adapter (no nostr-tools Relay: one
// on-demand socket to the wallet relay per call session, closed right after —
// the wallet relay never joins the resting pool; battery rules, guide 06 §3).
//
// NWC encrypts with the *connection secret* from the wallet URI, NOT the
// user's identity key — so this never touches the signer. The URI itself
// lives ONLY in SecureStore (never Redux, never SQLite).

import { hexToBytes } from "@noble/hashes/utils";
// nostr-tools: ./nip47 is NOT an exported subpath — import from the root.
import { nip04, nip47 } from "nostr-tools";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { getConversationKey, encrypt as nip44Encrypt, decrypt as nip44Decrypt } from "nostr-tools/nip44";
import type { NostrEvent, RelayMessage } from "@thewired/shared-types";

import type { WebSocketFactory, WebSocketLike } from "@/core/adapters";
import { isSafePeerRelayUrl } from "@/lib/nostr/relayUrl";

/** SecureStore key holding the raw NWC URI. */
export const NWC_SECRET_KEY = "wallet.nwc";

export interface ParsedNwc {
  walletPubkey: string;
  relayUrl: string;
  secretHex: string;
  lud16?: string;
}

/** Parse + validate a `nostr+walletconnect://` URI. Throws user-readable. */
export function parseNwcUri(uri: string): ParsedNwc {
  const trimmed = uri.trim();
  let conn: { pubkey: string; relay: string; secret: string };
  try {
    conn = nip47.parseConnectionString(trimmed);
  } catch {
    throw new Error("That doesn't look like a nostr+walletconnect:// URI.");
  }
  if (!/^[0-9a-f]{64}$/i.test(conn.pubkey)) throw new Error("Invalid wallet pubkey in URI.");
  if (!/^[0-9a-f]{64}$/i.test(conn.secret)) throw new Error("Invalid secret in URI.");
  if (!conn.relay || !isSafePeerRelayUrl(conn.relay)) {
    throw new Error("The wallet relay must be a public wss:// URL.");
  }
  let lud16: string | undefined;
  try {
    lud16 = new URL(trimmed).searchParams.get("lud16") ?? undefined;
  } catch {
    /* no lud16 in URI */
  }
  return { walletPubkey: conn.pubkey, relayUrl: conn.relay, secretHex: conn.secret, lud16 };
}

type EncryptionMode = "nip44_v2" | "nip04";

const INFO_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const WS_OPEN = 1;

/** One NWC call session: open the wallet relay socket, negotiate encryption
 *  from the 13194 info event, run the calls, close. */
export class NwcSession {
  private ws: WebSocketLike | null = null;
  private mode: EncryptionMode | null = null;
  private readonly secretBytes: Uint8Array;
  private readonly convKey: Uint8Array;
  private readonly handlers = new Map<string, (event: NostrEvent) => void>();
  private eoseHandlers = new Map<string, () => void>();
  private subSeq = 0;

  constructor(
    private readonly parsed: ParsedNwc,
    private readonly wsFactory: WebSocketFactory,
  ) {
    this.secretBytes = hexToBytes(parsed.secretHex);
    this.convKey = getConversationKey(this.secretBytes, parsed.walletPubkey);
  }

  private async connect(): Promise<WebSocketLike> {
    if (this.ws && this.ws.readyState === WS_OPEN) return this.ws;
    const ws = this.wsFactory.create(this.parsed.relayUrl);
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Wallet relay unreachable.")), 10_000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Couldn't connect to the wallet relay."));
      };
    });
    ws.onmessage = (m) => {
      let frame: RelayMessage;
      try {
        frame = JSON.parse(String(m.data)) as RelayMessage;
      } catch {
        return;
      }
      if (frame[0] === "EVENT") this.handlers.get(frame[1])?.(frame[2]);
      if (frame[0] === "EOSE") this.eoseHandlers.get(frame[1])?.();
    };
    return ws;
  }

  /** One-shot REQ for the newest matching event (or null on EOSE/timeout). */
  private async fetchOne(
    filter: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<NostrEvent | null> {
    const ws = await this.connect();
    const subId = `nwc-${this.subSeq++}`;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (event: NostrEvent | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.handlers.delete(subId);
        this.eoseHandlers.delete(subId);
        if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
        resolve(event);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.handlers.set(subId, (event) => finish(event));
      this.eoseHandlers.set(subId, () => finish(null));
      ws.send(JSON.stringify(["REQ", subId, filter]));
    });
  }

  private async getMode(): Promise<EncryptionMode> {
    if (this.mode) return this.mode;
    const info = await this.fetchOne(
      { kinds: [13194], authors: [this.parsed.walletPubkey], limit: 1 },
      INFO_TIMEOUT_MS,
    );
    if (info) {
      const encTag = info.tags.find((t) => t[0] === "encryption")?.[1] ?? "";
      this.mode = encTag.includes("nip44_v2") ? "nip44_v2" : "nip04";
    } else {
      // No info event on this relay ⇒ assume the modern default.
      this.mode = "nip44_v2";
    }
    return this.mode;
  }

  private encryptPayload(plaintext: string, mode: EncryptionMode): string {
    return mode === "nip04"
      ? (nip04.encrypt(this.secretBytes, this.parsed.walletPubkey, plaintext) as string)
      : nip44Encrypt(plaintext, this.convKey);
  }

  private decryptPayload(payload: string, mode: EncryptionMode): string {
    return mode === "nip04"
      ? (nip04.decrypt(this.secretBytes, this.parsed.walletPubkey, payload) as string)
      : nip44Decrypt(payload, this.convKey);
  }

  /** Send an NWC request and await the matching 23195 response. */
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const mode = await this.getMode();
    const ws = await this.connect();

    const tags: string[][] = [["p", this.parsed.walletPubkey]];
    if (mode === "nip44_v2") tags.push(["encryption", "nip44_v2"]);
    const reqEvent = finalizeEvent(
      {
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: this.encryptPayload(JSON.stringify({ method, params }), mode),
      },
      this.secretBytes,
    );

    const subId = `nwc-${this.subSeq++}`;
    const response = new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.handlers.delete(subId);
        if (ws.readyState === WS_OPEN) ws.send(JSON.stringify(["CLOSE", subId]));
        run();
      };
      const timer = setTimeout(
        () => finish(() => reject(new Error("Wallet did not respond in time."))),
        CALL_TIMEOUT_MS,
      );
      this.handlers.set(subId, (event) => {
        try {
          const parsed = JSON.parse(this.decryptPayload(event.content, mode)) as {
            result?: T;
            error?: { code?: string; message?: string };
          };
          if (parsed.error) {
            finish(() =>
              reject(new Error(parsed.error?.message || parsed.error?.code || "Wallet error")),
            );
          } else {
            finish(() => resolve(parsed.result as T));
          }
        } catch {
          finish(() => reject(new Error("Failed to decode wallet response")));
        }
      });
      ws.send(
        JSON.stringify([
          "REQ",
          subId,
          { kinds: [23195], authors: [this.parsed.walletPubkey], "#e": [reqEvent.id] },
        ]),
      );
      ws.send(JSON.stringify(["EVENT", reqEvent]));
    });
    return response;
  }

  getBalance(): Promise<{ balance: number }> {
    return this.call<{ balance: number }>("get_balance");
  }

  getWalletInfo(): Promise<{ alias?: string; methods?: string[] }> {
    return this.call<{ alias?: string; methods?: string[] }>("get_info");
  }

  payInvoice(invoice: string, amountMsat?: number): Promise<{ preimage: string }> {
    const params: Record<string, unknown> = { invoice };
    if (amountMsat !== undefined) params.amount = amountMsat;
    return this.call<{ preimage: string }>("pay_invoice", params);
  }

  /** The pubkey derived from the connection secret (the "client" key). */
  get clientPubkey(): string {
    return getPublicKey(this.secretBytes);
  }

  /** Idle-close: the wallet relay socket must not outlive the call session. */
  close(): void {
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      try {
        this.ws.close();
      } catch {
        /* already dead */
      }
    }
    this.ws = null;
    this.handlers.clear();
    this.eoseHandlers.clear();
  }
}
