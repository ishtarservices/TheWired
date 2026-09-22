// Bridges from the protocol layer to the DM feature's presence senders
// without a static import cycle (eventPipeline → features/dm → store …).
// Delivered receipts are batched per conversation so a burst of incoming
// messages yields one kind-20015 rumor.

const DELIVERED_BATCH_MS = 1500;
const pending = new Map<string, Set<string>>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush(): Promise<void> {
  timer = null;
  const batch = new Map(pending);
  pending.clear();
  const { sendReceipt } = await import("@/features/dm/dmService");
  for (const [conversationId, ids] of batch) {
    await sendReceipt(conversationId, "delivered", [...ids]);
  }
}

/** Queue a delivered receipt for a rumor we just unwrapped. */
export function queueDeliveredReceipt(conversationId: string, rumorId: string): void {
  const set = pending.get(conversationId) ?? new Set<string>();
  set.add(rumorId);
  pending.set(conversationId, set);
  if (!timer) timer = setTimeout(() => void flush(), DELIVERED_BATCH_MS);
}

/** Test hook. */
export function __resetDMSignalsForTest(): void {
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = null;
}
