import type { NostrEvent } from "../../types/nostr";
import { store } from "../../store";

/** Hard ceiling on queued (not-yet-started) wraps. A cold-start backlog of
 *  thousands of gift wraps would otherwise fire thousands of concurrent signer
 *  calls. Past this we drop + let the caller unmark for a later retry. */
const MAX_PENDING = 300;

/** Concurrency by signer: a NIP-46 bunker round-trips over the network per
 *  decrypt (serialize to 1); the OS keychain (tauri) is local and fast; a NIP-07
 *  extension is in between. */
function concurrencyForSigner(): number {
  switch (store.getState().identity.signerType) {
    case "tauri_keystore":
      return 4;
    case "nip46":
      return 1;
    default:
      return 2; // nip07
  }
}

/**
 * Concurrency-limited queue for gift-wrap (kind:1059) decryption (audit #4/#25).
 * The pipeline submits wraps fire-and-forget; the queue defers them and runs at
 * most N at once so a backlog can't saturate the signer (and, for NIP-46, flood
 * the bunker). The handler (handleGiftWrap) is unchanged and re-reads identity
 * itself, so a wrap that dequeues after an account switch is dropped there.
 */
class DecryptQueue {
  private queue: NostrEvent[] = [];
  private active = 0;
  private handler: ((event: NostrEvent) => Promise<void> | void) | null = null;

  /** Wired once by eventPipeline at module init. */
  setHandler(handler: (event: NostrEvent) => Promise<void> | void): void {
    this.handler = handler;
  }

  /** Returns false if the queue is saturated (caller should unmark for retry). */
  submit(event: NostrEvent): boolean {
    if (this.queue.length >= MAX_PENDING) return false;
    this.queue.push(event);
    this.pump();
    return true;
  }

  /** Drop everything queued (account switch / logout). In-flight handlers finish
   *  but self-guard on identity. */
  clear(): void {
    this.queue = [];
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private pump(): void {
    const limit = concurrencyForSigner();
    while (this.active < limit && this.queue.length > 0) {
      const event = this.queue.shift()!;
      this.active++;
      Promise.resolve(this.handler?.(event))
        .catch(() => {
          /* handler self-handles errors; never let one wrap wedge the queue */
        })
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}

export const decryptQueue = new DecryptQueue();
/** Exported for tests (so each gets a fresh instance, not the shared singleton). */
export { DecryptQueue };
