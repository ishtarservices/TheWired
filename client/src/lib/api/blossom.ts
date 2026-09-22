import { getSigner } from "@/lib/nostr/loginFlow";
import { signingQueue } from "@/lib/nostr/signingQueue";
import { fetch as tauriPluginFetch } from "@tauri-apps/plugin-http";

/** Tauri's HTTP plugin bypasses CORS in the desktop app; the browser preview
 *  has no `invoke` bridge, so use window.fetch there. */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const tauriFetch: typeof fetch = isTauri ? (tauriPluginFetch as unknown as typeof fetch) : (...a) => fetch(...a);

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

/** Compute SHA-256 hex hash of bytes */
async function hashBytes(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The app's own Blossom endpoint (backend behind the gateway), tried first
 *  for encrypted DM blobs so the ciphertext stays on infrastructure we run.
 *  Falls back to the public servers. */
function ownBlossomServer(): string | null {
  const base = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
  if (!base) return null;
  return base.replace(/\/api\/?$/, "");
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
  const ext = file.name.split(".").pop() ?? "";
  return blossomUploadBytes(new Uint8Array(await file.arrayBuffer()), file.type, { servers, ext });
}

/**
 * Upload raw bytes (e.g. an AES-GCM-encrypted DM attachment, docs/DM_WIRE_CONTRACT.md
 * §3.4). Opaque blobs go as `application/octet-stream`; with `preferOwn` the
 * app's own Blossom server is tried before the public list.
 */
export async function blossomUploadBytes(
  body: Uint8Array,
  mimeType: string,
  opts: { servers?: string[]; ext?: string; preferOwn?: boolean } = {},
): Promise<BlossomUploadResult> {
  // Copy into a plain ArrayBuffer-backed view (fetch's BodyInit typing).
  const payload = new Uint8Array(body);
  const sha256 = await hashBytes(payload);
  const ext = opts.ext ?? "";
  const own = opts.preferOwn ? ownBlossomServer() : null;
  const serverList = [...(own ? [own] : []), ...(opts.servers ?? DEFAULT_SERVERS)];
  const authToken = await buildBlossomAuth(sha256, payload.length, mimeType);
  const fileSize = payload.length;
  const fileType = mimeType;

  let lastError: Error | null = null;

  for (const server of serverList) {
    try {
      // BUD-02: upload endpoint is PUT /upload, not /<sha256>
      const uploadUrl = `${server}/upload`;

      const res = await tauriFetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": fileType,
          Authorization: `Nostr ${authToken}`,
        },
        body: payload,
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
        size: data.size ?? fileSize,
        mimeType: data.type ?? fileType,
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
