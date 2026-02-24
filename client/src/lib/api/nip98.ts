import { getSigner } from "@/lib/nostr/loginFlow";

/** Build a NIP-98 Authorization header for authenticated API requests */
export async function buildNip98Header(url: string, method: string): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const created_at = Math.floor(Date.now() / 1000);
  const unsignedEvent = {
    pubkey: await signer.getPublicKey(),
    created_at,
    kind: 27235,
    tags: [
      ["u", url],
      ["method", method.toUpperCase()],
    ],
    content: "",
  };

  const signed = await signer.signEvent(unsignedEvent);
  const encoded = btoa(JSON.stringify(signed));
  return `Nostr ${encoded}`;
}
