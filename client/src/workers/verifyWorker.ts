import { verifyEventSync, type VerifiableEvent } from "../lib/nostr/verifyEvent";

interface VerifyRequest {
  type: "verify";
  id: number;
  event: VerifiableEvent;
}

interface VerifyResponse {
  type: "verified" | "invalid";
  id: number;
  eventId: string;
}

self.onmessage = (e: MessageEvent<VerifyRequest>) => {
  const { id, event } = e.data;
  const valid = verifyEventSync(event);
  respond({
    type: valid ? "verified" : "invalid",
    id,
    eventId: event.id,
  });
};

function respond(msg: VerifyResponse) {
  self.postMessage(msg);
}
