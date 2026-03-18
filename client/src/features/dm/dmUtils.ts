import type { Kind0Profile } from "@/types/profile";

/** Derive a display name from a profile, falling back to a truncated pubkey */
export function getDisplayName(
  profile: Kind0Profile | null | undefined,
  pubkey: string,
): string {
  return (
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "..."
  );
}

/** Truncate a string for message preview display */
export function truncatePreview(text: string, max = 50): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}
