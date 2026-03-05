import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

const DEFAULT_SERVERS = [
  "https://blossom.primal.net",
  "https://cdn.satellite.earth",
  "https://blossom.oxtr.dev",
];

export interface BlossomUploadResult {
  url: string;
  sha256: string;
  size: number;
  mimeType: string;
}

/** Compute SHA-256 hex hash of a file */
async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Build a Blossom auth event (kind:24242) for upload authorization */
async function buildBlossomAuth(
  sha256: string,
  size: number,
  mimeType: string,
): Promise<string> {
  const signer = getSigner();
  if (!signer) throw new Error("No signer available");

  const created_at = Math.floor(Date.now() / 1000);
  const expiration = String(created_at + 300); // 5 min
  const pubkey = await signingQueue.enqueue(() => signer.getPublicKey());

  const unsigned = {
    pubkey,
    created_at,
    kind: 24242,
    tags: [
      ["t", "upload"],
      ["x", sha256],
      ["size", String(size)],
      ["m", mimeType],
      ["expiration", expiration],
    ],
    content: `Upload ${mimeType}`,
  };

  const signed = await signingQueue.enqueue(() => signer.signEvent(unsigned));
  return btoa(JSON.stringify(signed));
}

/**
 * Upload a file to a Blossom server.
 * Uses Tauri's HTTP plugin to bypass CORS restrictions.
 * Tries each server in order until one succeeds.
 */
export async function blossomUpload(
  file: File,
  servers?: string[],
): Promise<BlossomUploadResult> {
  const sha256 = await hashFile(file);
  const ext = file.name.split(".").pop() ?? "";
  const serverList = servers ?? DEFAULT_SERVERS;
  const authToken = await buildBlossomAuth(sha256, file.size, file.type);

  let lastError: Error | null = null;

  for (const server of serverList) {
    try {
      // BUD-02: upload endpoint is PUT /upload, not /<sha256>
      const uploadUrl = `${server}/upload`;
      const body = new Uint8Array(await file.arrayBuffer());

      const res = await tauriFetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          Authorization: `Nostr ${authToken}`,
        },
        body,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`${server}: ${res.status} ${text}`);
      }

      // Server returns { url, sha256, size, type, created }
      const data = await res.json();

      return {
        url: data.url ?? `${server}/${sha256}${ext ? `.${ext}` : ""}`,
        sha256: data.sha256 ?? sha256,
        size: data.size ?? file.size,
        mimeType: data.type ?? file.type,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Blossom] Upload to ${server} failed:`, lastError.message);
    }
  }

  throw new Error(
    `All Blossom servers failed. Last error: ${lastError?.message}`,
  );
}
