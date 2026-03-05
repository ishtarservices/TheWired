import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";

/** Build a NIP-98 Authorization header for authenticated API requests */
export async function buildNip98Header(url: string, method: string): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const created_at = Math.floor(Date.now() / 1000);
  const pubkey = await signingQueue.enqueue(() => signer.getPublicKey());
  const unsignedEvent = {
    pubkey,
    created_at,
    kind: 27235,
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
    ],
    content: "",
  };

  const signed = await signingQueue.enqueue(() => signer.signEvent(unsignedEvent));
  const encoded = btoa(JSON.stringify(signed));
  return `Nostr ${encoded}`;
}
