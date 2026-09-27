// Per-sender key management for voice/video CHANNELS (docs/E2EE_CALLS.md §4).
//
// Unlike a 1:1 call there is no pre-shared secret and membership changes, so
// every participant generates its own random sender key and distributes it,
// NIP-44 gift-wrapped (kind 20016), to every co-participant's pubkey:
//
//   join      → send our CURRENT key to the joiner (and the NEXT one if a
//               rotation is in flight)
//   leave     → rotate: new random key at index (i+1) mod 256, send it to
//               everyone still here, then switch our encoder to it after
//               USE_KEY_DELAY_MS so receivers hold it before the first frame
//               under the new index arrives. Leave bursts are debounced.
//   reconnect → re-install our key locally and re-send it (a full LiveKit
//               reconnect can reset the worker's current index).
//
// Received envelopes are bound to THIS room and ordered per sender by `ts`.
// The class is transport- and SDK-agnostic (plain deps) so it is unit-tested
// with fake timers; `session.ts` wires it to LiveKit and the gift-wrap layer.
import {
  MEDIA_KEY_MAX_SKEW_MS,
  type DMMediaKey,
  type DMMediaKeyEnvelope,
} from "@ishtarservices/shared-types";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import type { SenderKeySink } from "./callKeys";

/** Grace between distributing a new key and encoding with it. */
export const USE_KEY_DELAY_MS = 2000;
/** Leave events inside this window collapse into one rotation. */
export const ROTATE_DEBOUNCE_MS = 500;
/** Above this many recipients a rotation is O(N) signer round-trips; warn. */
export const FANOUT_WARN_THRESHOLD = 15;
/** Long sessions rotate on a timer too, bounding how much media one key
 *  ever protects (SFrame §7.3). Membership changes rotate regardless. */
export const PERIODIC_ROTATE_MS = 30 * 60 * 1000;

const HEX64 = /^[0-9a-f]{64}$/;

export interface ChannelKeyDeps {
  roomName: string;
  myPubkey: string;
  sink: SenderKeySink;
  send: (to: string, envelope: DMMediaKeyEnvelope) => Promise<void>;
  /** Injection points for tests. */
  random32?: () => Uint8Array;
  now?: () => number;
  warn?: (msg: string, data?: unknown) => void;
  info?: (msg: string, data?: unknown) => void;
}

interface KeySlot {
  idx: number;
  key: Uint8Array;
}

export type RemoteKeyOutcome = "installed" | "wrong_room" | "stale" | "skew" | "bad_sender" | "disposed";

function defaultRandom32(): Uint8Array {
  const out = new Uint8Array(32);
  crypto.getRandomValues(out);
  return out;
}

export class ChannelKeyManager {
  private current: KeySlot | null = null;
  private next: KeySlot | null = null;
  private rotateTimer: ReturnType<typeof setTimeout> | null = null;
  private switchTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private rotateQueued = false;
  private readonly members = new Set<string>();
  private readonly lastTs = new Map<string, number>();
  private disposed = false;

  private readonly random32: () => Uint8Array;
  private readonly now: () => number;
  private readonly warn: (msg: string, data?: unknown) => void;
  private readonly info: (msg: string, data?: unknown) => void;

  constructor(private readonly deps: ChannelKeyDeps) {
    this.random32 = deps.random32 ?? defaultRandom32;
    this.now = deps.now ?? (() => Date.now());
    this.warn = deps.warn ?? (() => {});
    this.info = deps.info ?? (() => {});
  }

  get currentIndex(): number {
    return this.current?.idx ?? -1;
  }

  get nextIndex(): number {
    return this.next?.idx ?? -1;
  }

  get memberCount(): number {
    return this.members.size;
  }

  /** Generate key 0, install it, and hand it to everyone already present. */
  async start(initialMembers: Iterable<string>): Promise<void> {
    if (this.disposed) return;
    this.current = { idx: 0, key: this.random32() };
    await this.deps.sink.setSenderKey(this.deps.myPubkey, this.current.key, 0);
    for (const m of initialMembers) if (this.isPeer(m)) this.members.add(m);
    await this.sendTo([...this.members], this.currentKeys());
    this.periodicTimer = setInterval(() => this.scheduleRotate(), PERIODIC_ROTATE_MS);
  }

  async onParticipantJoined(identity: string): Promise<void> {
    if (this.disposed || !this.isPeer(identity)) return;
    this.members.add(identity);
    await this.sendTo([identity], this.currentKeys());
  }

  onParticipantLeft(identity: string): void {
    if (this.disposed) return;
    if (!this.members.delete(identity)) return;
    this.lastTs.delete(identity);
    this.scheduleRotate();
  }

  /** A kind-20016 envelope from `sender` (seal-verified upstream). */
  onRemoteKey(sender: string, env: DMMediaKeyEnvelope): RemoteKeyOutcome {
    if (this.disposed) return "disposed";
    if (!this.isPeer(sender)) return "bad_sender";
    if (env.room !== this.deps.roomName) return "wrong_room";
    if (Math.abs(this.now() - env.ts) > MEDIA_KEY_MAX_SKEW_MS) return "skew";
    const last = this.lastTs.get(sender);
    if (last !== undefined && env.ts < last) return "stale";
    this.lastTs.set(sender, env.ts);
    for (const k of env.keys) {
      void this.deps.sink
        .setSenderKey(sender, hexToBytes(k.key), k.idx)
        .catch((err) => this.warn(`could not install key idx=${k.idx} from ${sender.slice(0, 8)}`, err));
    }
    this.info(`installed ${env.keys.length} key(s) from ${sender.slice(0, 8)} idx=${env.keys.map((k) => k.idx).join(",")}`);
    return "installed";
  }

  /** After a LiveKit reconnect: re-assert our key and re-share it. */
  async onReconnected(): Promise<void> {
    if (this.disposed || !this.current) return;
    await this.deps.sink.setSenderKey(this.deps.myPubkey, this.current.key, this.current.idx);
    await this.sendTo([...this.members], this.currentKeys());
  }

  dispose(): void {
    this.disposed = true;
    if (this.rotateTimer) clearTimeout(this.rotateTimer);
    if (this.switchTimer) clearTimeout(this.switchTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.rotateTimer = null;
    this.switchTimer = null;
    this.periodicTimer = null;
    this.current = null;
    this.next = null;
    this.members.clear();
    this.lastTs.clear();
  }

  // ── internals ────────────────────────────────────────────────────

  private isPeer(identity: string): boolean {
    return HEX64.test(identity) && identity !== this.deps.myPubkey;
  }

  private currentKeys(): DMMediaKey[] {
    const keys: DMMediaKey[] = [];
    if (this.current) keys.push({ idx: this.current.idx, key: bytesToHex(this.current.key) });
    if (this.next) keys.push({ idx: this.next.idx, key: bytesToHex(this.next.key) });
    return keys;
  }

  private envelope(keys: DMMediaKey[]): DMMediaKeyEnvelope {
    return { v: 1, room: this.deps.roomName, keys, ts: this.now() };
  }

  private async sendTo(recipients: string[], keys: DMMediaKey[]): Promise<void> {
    if (recipients.length === 0 || keys.length === 0) return;
    if (recipients.length > FANOUT_WARN_THRESHOLD) {
      this.warn(`media-key fan-out to ${recipients.length} participants (one signed wrap each)`);
    }
    const env = this.envelope(keys);
    const results = await Promise.allSettled(recipients.map((to) => this.deps.send(to, env)));
    results.forEach((r, i) => {
      if (r.status === "rejected") this.warn(`media-key send to ${recipients[i].slice(0, 8)} failed`, r.reason);
    });
  }

  private scheduleRotate(): void {
    if (this.next) {
      // A rotation is already in flight; the leaver may hold `next`. Do it
      // again once the switch lands.
      this.rotateQueued = true;
      return;
    }
    if (this.rotateTimer) return;
    this.rotateTimer = setTimeout(() => {
      this.rotateTimer = null;
      void this.rotate();
    }, ROTATE_DEBOUNCE_MS);
  }

  private async rotate(): Promise<void> {
    if (this.disposed || !this.current || this.next) return;
    if (this.members.size === 0) {
      // Alone: nobody to protect the next key from. Keep the current key;
      // the next joiner gets it fresh.
      return;
    }
    this.next = { idx: (this.current.idx + 1) % 256, key: this.random32() };
    this.info(`rotating → idx=${this.next.idx} (${this.members.size} recipients)`);
    await this.sendTo([...this.members], [{ idx: this.next.idx, key: bytesToHex(this.next.key) }]);
    if (this.disposed || !this.next) return;
    this.switchTimer = setTimeout(() => {
      this.switchTimer = null;
      this.switchToNext().catch((err) => this.warn("encoder key switch failed", err));
    }, USE_KEY_DELAY_MS);
  }

  private async switchToNext(): Promise<void> {
    if (this.disposed || !this.next) return;
    const next = this.next;
    try {
      await this.deps.sink.setSenderKey(this.deps.myPubkey, next.key, next.idx);
    } catch (err) {
      // Keep encoding (and advertising) the key that is actually installed;
      // drop the pending one so the next rotation starts clean.
      this.next = null;
      throw err;
    }
    if (this.disposed) return;
    this.current = next;
    this.next = null;
    this.info(`encoder switched to idx=${this.current.idx}`);
    if (this.rotateQueued) {
      this.rotateQueued = false;
      this.scheduleRotate();
    }
  }
}
