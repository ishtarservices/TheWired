import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { schnorr } from "@noble/curves/secp256k1";

interface VerifyRequest {
  type: "verify";
  id: number;
  event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  };
}

interface VerifyResponse {
  type: "verified" | "invalid";
  id: number;
  eventId: string;
  reason?: string;
}

self.onmessage = (e: MessageEvent<VerifyRequest>) => {
  const { id, event } = e.data;

  try {
    // Step 1: Recompute event ID from canonical serialization
    const serialized = JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);

    const computedId = bytesToHex(sha256(new TextEncoder().encode(serialized)));

    if (computedId !== event.id) {
      respond({ type: "invalid", id, eventId: event.id, reason: "ID mismatch" });
      return;
    }

    // Step 2: Verify schnorr signature
    const valid = schnorr.verify(event.sig, event.id, event.pubkey);

    if (valid) {
      respond({ type: "verified", id, eventId: event.id });
    } else {
      respond({ type: "invalid", id, eventId: event.id, reason: "Bad signature" });
    }
  } catch (err) {
    respond({
      type: "invalid",
      id,
      eventId: event.id,
      reason: err instanceof Error ? err.message : "Unknown error",
    });
  }
};

function respond(msg: VerifyResponse) {
  self.postMessage(msg);
}
