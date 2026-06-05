/**
 * HTTP transport for LLM engines. On desktop (Tauri) we use the native HTTP
 * plugin, which bypasses browser CORS — necessary for local engines (Ollama,
 * LM Studio) whose default origin policy blocks the webview, and to send
 * arbitrary headers to cloud APIs. On web we fall back to browser `fetch`.
 *
 * Mirrors the transport split in `lib/lightning/lnurl.ts` / `lib/api/blossom.ts`.
 */

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function engineFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}

/** Fetch with a hard timeout (used for local-engine detection probes). */
export async function engineFetchWithTimeout(
  url: string,
  ms: number,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await engineFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
