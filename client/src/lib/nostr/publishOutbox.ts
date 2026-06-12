import type { NostrEvent } from "../../types/nostr";
import { relayManager } from "./relayManager";
import { store } from "../../store";
import { putOutbox, deleteOutbox, getAllOutbox } from "../db/outboxStore";
import { createLogger } from "../debug/logger";

const log = createLogger("outbox");

/** Replay rows newer than this; older ones are dropped (audit decision #12 —
 *  auto-replay <24h on next launch, then drop). */
const OUTBOX_TTL_MS = 24 * 60 * 60 * 1000;

/** Replaceable + parameterized-replaceable kinds. Replaying a stale one would
 *  clobber a newer profile/contacts/relay-list, so we skip if the store already
 *  holds a newer version for the same (kind, pubkey, d-tag). */
function isReplaceable(kind: number): boolean {
  return (
    kind === 0 ||
    kind === 3 ||
    (kind >= 10000 && kind < 20000) ||
    (kind >= 30000 && kind < 40000)
  );
}

/**
 * Durable publish backstop (audit #34/#2). signAndPublish records every signed
 * event here; the FIRST relay OK deletes the row. Un-acked rows are re-published
 * on reconnect and on next launch, so a relay drop / refresh can't silently lose
 * a publish. Idempotent by event id (relays + the client dedup collapse repeats).
 *
 * Everything is fire-and-forget / background — it never adds latency to the
 * publish path or blocks the UI.
 */
class PublishOutbox {
  /** ids awaiting a relay OK — lets handleOK skip an IDB round-trip on every OK. */
  private pending = new Set<string>();
  /** Guards against overlapping replays (reconnect can fire in bursts). */
  private replaying = false;

  /** Record a just-published event. Fire-and-forget (non-blocking). */
  record(event: NostrEvent, targetRelays?: string[], now = Date.now()): void {
    this.pending.add(event.id);
    putOutbox(event, targetRelays, now).catch(() => {
      /* durability is best-effort; the live publish already went out */
    });
  }

  /** Wired into the global relay OK stream. First success clears the row. */
  handleOK(eventId: string, success: boolean): void {
    if (!success || !this.pending.has(eventId)) return;
    this.pending.delete(eventId);
    deleteOutbox(eventId).catch(() => {});
  }

  /** Re-publish un-acked events. Called on next launch (after login) and on every
   *  relay reconnect. Drops >24h rows and stale replaceable events. */
  async replay(now = Date.now()): Promise<void> {
    if (this.replaying) return;
    this.replaying = true;
    let rows;
    try {
      rows = await getAllOutbox();
    } catch {
      this.replaying = false;
      return;
    }
    let replayed = 0;
    for (const row of rows) {
      if (now - row.queuedAt > OUTBOX_TTL_MS) {
        deleteOutbox(row.id).catch(() => {});
        continue;
      }
      if (isReplaceable(row.event.kind) && this.hasNewerReplaceable(row.event)) {
        deleteOutbox(row.id).catch(() => {});
        continue;
      }
      this.pending.add(row.id);
      relayManager.publish(row.event, row.targetRelays);
      replayed++;
    }
    if (replayed > 0) log.info(`replayed ${replayed} un-acked publish(es)`);
    this.replaying = false;
  }

  /** True if the entity store holds a newer event for this replaceable address. */
  private hasNewerReplaceable(event: NostrEvent): boolean {
    const dTag = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
    const events = store.getState().events;
    for (const id of events.ids) {
      const e = events.entities[id];
      if (!e || e.kind !== event.kind || e.pubkey !== event.pubkey) continue;
      const ed = e.tags.find((t) => t[0] === "d")?.[1] ?? "";
      if (ed === dTag && e.created_at > event.created_at) return true;
    }
    return false;
  }
}

export const publishOutbox = new PublishOutbox();
