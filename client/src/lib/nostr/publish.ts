import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import { getSigner, getSignerTimeoutMs } from "./loginFlow";
import { signingQueue } from "./signingQueue";
import { relayManager } from "./relayManager";
import { processIncomingEvent } from "./eventPipeline";
import { putEvent } from "../db/eventStore";
import { addLocalEventId } from "../db/musicStore";
import { publishOutbox } from "./publishOutbox";
import { resolvePublishTargets } from "./gatedTargets";
import { store } from "@/store";

/**
 * Where an event goes when the caller named no relays. Public events use the
 * default write relays; a space-scoped or private event (valued `h` /
 * `visibility` tag) is routed to the app relay + the listed spaces' host
 * relays instead, so it can never land on a public relay by omission
 * (docs/MUSIC_VISIBILITY.md). Host relays are connected on demand; the outbox
 * replays anything un-acked on reconnect.
 */
function targetsFor(tags: string[][], targetRelays?: string[]): string[] | undefined {
  const resolved = resolvePublishTargets(tags, targetRelays, store.getState().spaces.list);
  if (resolved && !targetRelays) {
    for (const url of resolved) relayManager.connect(url, "read+write");
  }
  return resolved;
}

/** Sign and publish an event to write relays */
export async function signAndPublish(
  unsigned: UnsignedEvent,
  targetRelays?: string[],
): Promise<NostrEvent> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const signed = await signingQueue.enqueue(
    () => signer.signEvent(unsigned),
    getSignerTimeoutMs(),
  );
  const targets = targetsFor(signed.tags, targetRelays);
  const sentTo = relayManager.publish(signed, targets);

  // Durability backstop: record before/independent of the relay result so a relay
  // drop or refresh can't lose the publish. Fire-and-forget — never blocks the
  // send. The first relay OK clears the row; un-acked rows replay on reconnect
  // and next launch (audit #34).
  publishOutbox.record(signed, targets);

  if (sentTo === 0) {
    console.warn("[publish] event sent to 0 relays", {
      kind: signed.kind,
      id: signed.id,
      targetRelays: targets,
    });
  }

  // Persist to IndexedDB so events survive page refresh
  await putEvent(signed);

  // Process locally so the event appears in Redux immediately
  // (dedup will prevent double-processing when it bounces back from relays)
  await processIncomingEvent(signed, "local");

  return signed;
}

/** Sign an event and save it locally without publishing to relays */
export async function signAndSaveLocally(
  unsigned: UnsignedEvent,
): Promise<NostrEvent> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const signed = await signingQueue.enqueue(
    () => signer.signEvent(unsigned),
    getSignerTimeoutMs(),
  );

  // Persist to IndexedDB
  await putEvent(signed);

  // Track as a local-only event
  await addLocalEventId(signed.id);

  // Process through the pipeline so it shows up in Redux immediately
  processIncomingEvent(signed, "local");

  return signed;
}

/** Publish an already-signed event to relays (e.g. promoting local → public) */
export async function publishExisting(
  event: NostrEvent,
  targetRelays?: string[],
): Promise<void> {
  relayManager.publish(event, targetsFor(event.tags, targetRelays));
}
