import type { NostrEvent } from "../../types/nostr";

interface PendingVerification {
  resolve: (valid: boolean) => void;
  reject: (err: Error) => void;
}

class VerifyWorkerBridge {
  private worker: Worker | null = null;
  private pending = new Map<number, PendingVerification>();
  private nextId = 0;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL("../../workers/verifyWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id } = e.data;
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          p.resolve(type === "verified");
        }
      };
      this.worker.onerror = (e) => {
        console.error("Verify worker error:", e);
      };
    }
    return this.worker;
  }

  verify(event: NostrEvent): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });

      try {
        this.getWorker().postMessage({
          type: "verify",
          id,
          event: {
            id: event.id,
            pubkey: event.pubkey,
            created_at: event.created_at,
            kind: event.kind,
            tags: event.tags,
            content: event.content,
            sig: event.sig,
          },
        });
      } catch (err) {
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }

      // Timeout after 5s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("Verification timeout"));
        }
      }, 5000);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("Worker terminated"));
    }
    this.pending.clear();
  }
}

export const verifyBridge = new VerifyWorkerBridge();
