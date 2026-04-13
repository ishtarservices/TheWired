import type { NostrEvent, UnsignedEvent } from "../../types/nostr";
import { getSigner } from "./loginFlow";
import { signingQueue } from "./signingQueue";
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

  console.debug("[publish] Signing event", {
    kind: unsigned.kind,
    tagCount: unsigned.tags.length,
    contentLength: unsigned.content?.length ?? 0,
    pTags: unsigned.tags.filter((t) => t[0] === "p").map((t) => ({ pk: t[1]?.slice(0, 8), role: t[3] })),
  });

  const signed = await signingQueue.enqueue(() => signer.signEvent(unsigned));
  console.debug("[publish] Event signed", { eventId: signed.id.slice(0, 12), kind: signed.kind });

  relayManager.publish(signed, targetRelays);
  console.debug("[publish] Published to relays", { targetRelays: targetRelays ?? "default write relays" });

  // Persist to IndexedDB so events survive page refresh
  await putEvent(signed);

  // Process locally so the event appears in Redux immediately
  // (dedup will prevent double-processing when it bounces back from relays)
  await processIncomingEvent(signed, "local");
  console.debug("[publish] Local processing complete", { eventId: signed.id.slice(0, 12) });

  return signed;
}

/** Sign an event and save it locally without publishing to relays */
export async function signAndSaveLocally(
  unsigned: UnsignedEvent,
): Promise<NostrEvent> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const signed = await signingQueue.enqueue(() => signer.signEvent(unsigned));

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
