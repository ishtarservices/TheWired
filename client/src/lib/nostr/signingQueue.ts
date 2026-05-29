/**
 * FIFO signing queue that serializes all signer operations.
 * Prevents race conditions when multiple components request
 * signing/encryption concurrently.
 */

const TIMEOUT_MS = 12_000;

type QueueEntry<T> = {
  fn: () => Promise<T>;
  timeoutMs: number;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

class SigningQueue {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queue: QueueEntry<any>[] = [];
  private running = false;

  /**
   * Enqueue an async signer operation. Resolves when it completes.
   * `timeoutMs` lets slow signers (e.g. a NIP-46 bunker awaiting manual approval)
   * use a longer budget than the fast local-signer default.
   */
  enqueue<T>(fn: () => Promise<T>, timeoutMs: number = TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ fn, timeoutMs, resolve, reject });
      if (!this.running) this.drain();
    });
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.queue.length > 0) {
      const entry = this.queue.shift()!;
      try {
        const result = await Promise.race([
          entry.fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Signing operation timed out")), entry.timeoutMs),
          ),
        ]);
        entry.resolve(result);
      } catch (err) {
        entry.reject(err);
      }
    }
    this.running = false;
  }
}

/** Module-level singleton */
export const signingQueue = new SigningQueue();
