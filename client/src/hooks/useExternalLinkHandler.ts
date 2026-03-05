import { useEffect } from "react";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Global click interceptor that opens external links in the system browser
 * when running inside Tauri. In web context this is a no-op.
 */
export function useExternalLinkHandler() {
  useEffect(() => {
    if (!isTauri) return;

    const handler = async (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // Only intercept external http(s) links
      if (!href.startsWith("http://") && !href.startsWith("https://")) return;

      e.preventDefault();
      e.stopPropagation();

      try {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(href);
      } catch (err) {
        console.error("Failed to open URL:", err);
      }
    };

    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, []);
}
