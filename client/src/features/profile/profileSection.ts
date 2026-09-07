import type { ProfileTab } from "@ishtarservices/core";
import { ALL_TABS } from "@ishtarservices/core";

/**
 * Initial profile tab for a `/profile/:pubkey?section=…` link (the mobile
 * app's "share your catalog" emits `?section=music`). A recognised section
 * wins over the remembered view; anything else falls back to it.
 */
export function initialProfileTab(
  sectionParam: string | null | undefined,
  stored: ProfileTab | undefined,
): ProfileTab {
  const section = sectionParam?.toLowerCase();
  const known = ALL_TABS.find((t) => t === section);
  return known ?? stored ?? "notes";
}
