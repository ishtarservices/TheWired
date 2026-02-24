import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import { getSigner } from "./loginFlow";
import { relayManager } from "./relayManager";
import { processIncomingEvent } from "./eventPipeline";
import { putEvent } from "../db/eventStore";
import { addLocalEventId } from "../db/musicStore";

/** Sign and publish an event to write relays */
export async function signAndPublish(
  unsigned: UnsignedEvent,
  targetRelays?: string[],
): Promise<NostrEvent> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const signed = await signer.signEvent(unsigned);
  relayManager.publish(signed, targetRelays);

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

  const signed = await signer.signEvent(unsigned);

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
  relayManager.publish(event, targetRelays);
}
