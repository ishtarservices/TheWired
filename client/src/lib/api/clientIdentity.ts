/**
 * X-Wired-Client: tells the backend which of our apps an authenticated API
 * request came from, so the activity report can tell desktop users from
 * mobile users from external Nostr clients. Sent only alongside a NIP-98
 * Authorization header; the backend records it against the verified pubkey
 * (app, platform, version, first/last seen) and nothing else.
 *
 *   X-Wired-Client: desktop/<version> (<platform>)
 */
export const WIRED_CLIENT_HEADER = "X-Wired-Client";

export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

export function detectPlatform(userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent): DesktopPlatform {
  if (/Mac OS X|Macintosh/i.test(userAgent)) return "macos";
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Linux|X11/i.test(userAgent)) return "linux";
  return "unknown";
}

export function wiredClientHeaderValue(): string {
  return `desktop/${__APP_VERSION__} (${detectPlatform()})`;
}
