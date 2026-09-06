/**
 * Coarse platform detection for the few places where the desktop WebViews
 * genuinely differ (WebView2 on Windows vs WKWebView on macOS):
 *
 * - audio output selection (`setSinkId`) exists on Chromium/WebView2 only
 * - screen-share system audio is available on Windows only
 * - OS permission hints in media error messages
 *
 * Evaluated once; safe under jsdom (everything is false there).
 */

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
const plat = typeof navigator !== "undefined" ? navigator.platform ?? "" : "";

export const isTauri: boolean =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

export const isWindows: boolean = /Windows|Win32|Win64/i.test(ua) || /^Win/i.test(plat);

export const isMacOS: boolean = /Macintosh|Mac OS X/i.test(ua) || /^Mac/i.test(plat);

export const isLinux: boolean = !isWindows && !isMacOS && /Linux|X11/i.test(ua);

/** Chromium-based engines expose `HTMLMediaElement.setSinkId`; WKWebView does not. */
export const supportsAudioOutputSelection: boolean =
  typeof HTMLMediaElement !== "undefined" &&
  typeof (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId === "function";
