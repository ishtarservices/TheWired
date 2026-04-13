import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";

/**
 * Build a Blossom (kind 24242) Authorization header per BUD-11.
 * Similar to NIP-98 but uses t/x/expiration tags instead of u/method tags.
 */
export async function buildBlossomAuthHeader(
  action: "upload" | "delete" | "list" | "get",
  sha256?: string,
  serverDomain?: string,
): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const created_at = Math.floor(Date.now() / 1000);
  const expiration = String(created_at + 3600); // 1 hour
  const pubkey = await signingQueue.enqueue(() => signer.getPublicKey());

  const tags: string[][] = [
    ["t", action],
    ["expiration", expiration],
  ];
  if (sha256) tags.push(["x", sha256]);
  if (serverDomain) tags.push(["server", serverDomain]);

  const unsignedEvent = {
    pubkey,
    created_at,
    kind: 24242,
    tags,
    content: `${action} blob`,
  };

  const signed = await signingQueue.enqueue(() => signer.signEvent(unsignedEvent));
  const encoded = btoa(JSON.stringify(signed));
  return `Nostr ${encoded}`;
}
