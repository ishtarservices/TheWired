/**
 * Hand-rolled NWC (NIP-47) client. NWC encrypts with the *connection-secret* key from
 * the wallet URI (NOT the user's identity key), and uses its own dedicated relay — so
 * this can't reuse the keystore's nip44 commands or our relayManager.
 *
 * Built on nostr-tools primitives (nip44.v2 / nip04 / Relay / finalizeEvent). We only
 * need a few methods: get_info, get_balance, pay_invoice.
 */
import { Relay } from "nostr-tools/relay";
import {
  finalizeEvent,
  getPublicKey,
  type Event as NostrToolsEvent,
} from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import { nip04, nip47 } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils";
import { createLogger } from "../debug/logger";

const nwcLog = createLogger("nwc");

export interface ParsedNwc {
  walletPubkey: string;
  relayUrl: string;
  secretHex: string;
  lud16?: string;
}

export interface NwcClientOptions {
  /** Fired when the wallet relay closes unexpectedly. Use to mark the wallet offline.
   *  Suppressed on intentional `close()` calls (we null `relay.onclose` first). */
  onClose?: () => void;
}

/** NIP-47 notification payload pushed by the wallet (e.g. payment_received/sent). */
export interface WalletNotification {
  notification_type: string;
  notification: Record<string, unknown>;
}

/** Parse a `nostr+walletconnect://` URI into its parts. */
export function parseNwcUri(uri: string): ParsedNwc {
  const trimmed = uri.trim();
  const conn = nip47.parseConnectionString(trimmed);
  let lud16: string | undefined;
  try {
    lud16 = new URL(trimmed).searchParams.get("lud16") ?? undefined;
  } catch {
    /* no lud16 in URI */
  }
  return {
    walletPubkey: conn.pubkey,
    relayUrl: conn.relay,
    secretHex: conn.secret,
    lud16,
  };
}

type EncryptionMode = "nip44_v2" | "nip04";

interface NwcInfo {
  encryption: EncryptionMode;
  methods: string[];
  /** Notification types the wallet advertises (e.g. "payment_received", "payment_sent"). */
  notifications: string[];
}

const CALL_TIMEOUT_MS = 30_000;
const INFO_TIMEOUT_MS = 10_000;

export class NwcClient {
  private relay: Relay | null = null;
  private info: NwcInfo | null = null;
  private notifSub: { close: () => void } | null = null;
  private readonly secretBytes: Uint8Array;
  private readonly convKey: Uint8Array;
  private readonly clientPubkey: string;

  constructor(
    private readonly parsed: ParsedNwc,
    private readonly opts: NwcClientOptions = {},
  ) {
    this.secretBytes = hexToBytes(parsed.secretHex);
    this.convKey = nip44.v2.utils.getConversationKey(
      this.secretBytes,
      parsed.walletPubkey,
    );
    this.clientPubkey = getPublicKey(this.secretBytes);
  }

  static fromUri(uri: string, opts?: NwcClientOptions): NwcClient {
    return new NwcClient(parseNwcUri(uri), opts);
  }

  get walletPubkey(): string {
    return this.parsed.walletPubkey;
  }

  private async getRelay(): Promise<Relay> {
    if (this.relay && this.relay.connected) return this.relay;
    this.relay = await Relay.connect(this.parsed.relayUrl);
    // Hook the close handler so the owner (walletManager) can mark the wallet
    // offline as soon as the relay drops, instead of only on the next failed call.
    if (this.opts.onClose) {
      this.relay.onclose = this.opts.onClose;
    }
    return this.relay;
  }

  /** Read the 13194 info event once to negotiate encryption + list capabilities. */
  async getInfo(): Promise<NwcInfo> {
    if (this.info) return this.info;
    const relay = await this.getRelay();
    const infoEvent = await new Promise<NostrToolsEvent | null>((resolve) => {
      let settled = false;
      let sub: { close: () => void } | undefined;
      const finish = (v: NostrToolsEvent | null) => {
        if (settled) return;
        settled = true;
        try {
          sub?.close();
        } catch {
          /* noop */
        }
        resolve(v);
      };
      sub = relay.subscribe(
        [{ kinds: [13194], authors: [this.parsed.walletPubkey], limit: 1 }],
        { onevent: (evt) => finish(evt), oneose: () => finish(null) },
      );
      setTimeout(() => finish(null), INFO_TIMEOUT_MS);
    });

    let encryption: EncryptionMode = "nip44_v2";
    let methods: string[] = [];
    let notifications: string[] = [];
    if (infoEvent) {
      const encTag =
        infoEvent.tags.find((t) => t[0] === "encryption")?.[1] ?? "";
      // Prefer nip44_v2; fall back to nip04 only when nip44 isn't advertised
      // (absent tag ⇒ nip04 per NIP-47).
      if (encTag.includes("nip44_v2")) encryption = "nip44_v2";
      else encryption = "nip04";
      methods = infoEvent.content.split(/\s+/).filter(Boolean);
      const notifTag =
        infoEvent.tags.find((t) => t[0] === "notifications")?.[1] ?? "";
      notifications = notifTag.split(/\s+/).filter(Boolean);
    }
    // No info event found on this relay ⇒ assume nip44_v2 (modern default).
    this.info = { encryption, methods, notifications };
    nwcLog.info("info", {
      foundEvent: !!infoEvent,
      encryption: this.info.encryption,
      methods: this.info.methods,
      notifications: this.info.notifications,
    });
    return this.info;
  }

  private encrypt(plaintext: string, mode: EncryptionMode): string {
    return mode === "nip04"
      ? nip04.encrypt(this.secretBytes, this.parsed.walletPubkey, plaintext)
      : nip44.v2.encrypt(plaintext, this.convKey);
  }

  private decrypt(payload: string, mode: EncryptionMode): string {
    return mode === "nip04"
      ? nip04.decrypt(this.secretBytes, this.parsed.walletPubkey, payload)
      : nip44.v2.decrypt(payload, this.convKey);
  }

  /** Send an NWC request and await the matching 23195 response (correlated by `e` tag). */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const info = await this.getInfo();
    const relay = await this.getRelay();
    const mode = info.encryption;

    const tags: string[][] = [["p", this.parsed.walletPubkey]];
    if (mode === "nip44_v2") tags.push(["encryption", "nip44_v2"]);
    const reqEvent = finalizeEvent(
      {
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: this.encrypt(JSON.stringify({ method, params }), mode),
      },
      this.secretBytes,
    );
    nwcLog.info("call", { method, params, reqId: reqEvent.id.slice(0, 12) });

    // Single-promise pattern: the subscription, the timeout AND the publish failure
    // path all funnel through `finish` so the promise is always settled and the timer
    // is always cleared. Otherwise a publish rejection orphans the promise and the
    // 30s timeout later fires `reject` on it (unhandled-rejection bug).
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let sub: { close: () => void } | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (run: () => void) => {
        if (settled) return;
        settled = true;
        try {
          sub?.close();
        } catch {
          /* noop */
        }
        if (timer !== undefined) clearTimeout(timer);
        run();
      };
      sub = relay.subscribe(
        [
          {
            kinds: [23195],
            authors: [this.parsed.walletPubkey],
            "#e": [reqEvent.id],
          },
        ],
        {
          onevent: (evt) => {
            try {
              const parsed = JSON.parse(this.decrypt(evt.content, mode)) as {
                result?: T;
                error?: { code?: string; message?: string };
              };
              if (parsed.error) {
                nwcLog.warn("call error", { method, error: parsed.error });
                finish(() =>
                  reject(
                    new Error(
                      parsed.error?.message ||
                        parsed.error?.code ||
                        "Wallet error",
                    ),
                  ),
                );
              } else {
                nwcLog.info("call ok", { method, result: parsed.result });
                finish(() => resolve(parsed.result as T));
              }
            } catch (e) {
              finish(() =>
                reject(
                  e instanceof Error
                    ? e
                    : new Error("Failed to decode wallet response"),
                ),
              );
            }
          },
        },
      );
      timer = setTimeout(() => {
        nwcLog.warn("call timeout", { method });
        finish(() => reject(new Error("Wallet did not respond in time.")));
      }, CALL_TIMEOUT_MS);
      // Funnel publish errors through `finish` so the promise always settles and
      // the caller's `await` rejects fast (no 30s "buffering" on a dead relay).
      relay.publish(reqEvent).catch((e) => {
        nwcLog.warn("publish fail", {
          method,
          err: e instanceof Error ? e.message : String(e),
        });
        finish(() =>
          reject(
            e instanceof Error
              ? e
              : new Error("Failed to send request to wallet"),
          ),
        );
      });
    });
  }

  getBalance(): Promise<{ balance: number }> {
    return this.call<{ balance: number }>("get_balance");
  }

  getWalletInfo(): Promise<{ alias?: string; methods?: string[] }> {
    return this.call<{ alias?: string; methods?: string[] }>("get_info");
  }

  payInvoice(
    invoice: string,
    amountMsat?: number,
  ): Promise<{ preimage: string; fees_paid?: number }> {
    const params: Record<string, unknown> = { invoice };
    if (amountMsat !== undefined) params.amount = amountMsat;
    return this.call<{ preimage: string; fees_paid?: number }>(
      "pay_invoice",
      params,
    );
  }

  /**
   * Subscribe to NWC push notifications (kind 23197 nip44_v2, 23196 nip04 legacy).
   * No-op if the wallet's info event doesn't advertise any. Idempotent — calling
   * again replaces the previous subscription.
   */
  async startNotifications(
    onNotification: (notif: WalletNotification) => void,
  ): Promise<void> {
    const info = await this.getInfo();
    if (info.notifications.length === 0) {
      nwcLog.info("notifications skipped", { reason: "wallet advertises none" });
      return;
    }
    const relay = await this.getRelay();
    const notifKind = info.encryption === "nip44_v2" ? 23197 : 23196;
    try {
      this.notifSub?.close();
    } catch {
      /* noop */
    }
    nwcLog.info("notifications subscribed", {
      kind: notifKind,
      types: info.notifications,
    });
    this.notifSub = relay.subscribe(
      [
        {
          kinds: [notifKind],
          authors: [this.parsed.walletPubkey],
          "#p": [this.clientPubkey],
        },
      ],
      {
        onevent: (evt) => {
          try {
            const parsed = JSON.parse(
              this.decrypt(evt.content, info.encryption),
            ) as WalletNotification;
            nwcLog.info("notification", { type: parsed.notification_type });
            onNotification(parsed);
          } catch {
            /* malformed notification — ignore */
          }
        },
      },
    );
  }

  close(): void {
    try {
      this.notifSub?.close();
    } catch {
      /* noop */
    }
    this.notifSub = null;
    if (this.relay) {
      // Null the handler BEFORE closing so an intentional close doesn't trip the
      // onClose hook (which would falsely mark the wallet as offline).
      try {
        this.relay.onclose = null;
      } catch {
        /* noop */
      }
      try {
        this.relay.close();
      } catch {
        /* noop */
      }
    }
    this.relay = null;
  }
}
