/**
 * URL scheme allow-listing for untrusted AI-generated markdown. Mirrors the
 * `safeImageUrl` posture used for group metadata — only http(s) (and mailto for
 * links) survive; `javascript:`/`data:`/`vbscript:` and relative/garbage URLs are
 * dropped. The model's output is untrusted input (see the nostr-security skill).
 */
export function safeHref(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return ["http:", "https:", "mailto:"].includes(u.protocol)
      ? u.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function safeImageSrc(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
