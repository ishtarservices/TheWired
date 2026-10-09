/**
 * Links people share outside the app (space invites, music) must open
 * everywhere, so they are built on the public web origin, never on the
 * runtime one: that is `tauri://localhost` in the packaged desktop app and
 * `http://localhost:1420` in dev, which no phone or browser can open.
 *
 * soot builds the same `https://thewired.app/...` links, and the backend
 * serves the universal-link files for them (routes/wellKnown.ts), so a link
 * from either client opens soot on a phone that has it and the web preview
 * page everywhere else.
 */

const DEFAULT_PUBLIC_WEB_ORIGIN = "https://thewired.app";

/**
 * The origin of `raw` when it is an http(s) URL; the default otherwise.
 * Exported for tests.
 */
export function resolvePublicWebOrigin(raw: string | undefined): string {
  if (!raw) return DEFAULT_PUBLIC_WEB_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return DEFAULT_PUBLIC_WEB_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_PUBLIC_WEB_ORIGIN;
  }
}

/** Overridable for a dev stack that serves its own share pages (`VITE_PUBLIC_WEB_URL`). */
export const PUBLIC_WEB_ORIGIN = resolvePublicWebOrigin(import.meta.env.VITE_PUBLIC_WEB_URL);

/** `path` on the public web origin. */
export function publicWebUrl(path: string, origin: string = PUBLIC_WEB_ORIGIN): string {
  return `${origin}${path.startsWith("/") ? path : `/${path}`}`;
}
