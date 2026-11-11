import { isBackendBacked } from "./spaceType";
import type { Space } from "../../types/space";

/**
 * Who can find the space. Backend-backed spaces are listed in Discover or
 * invite-only; NIP-29-native ones are public or private groups on their relay.
 * Null when a backend-backed space's listing isn't known yet.
 */
export function spaceVisibility(space: Space): { label: string; open: boolean } | null {
  if (isBackendBacked(space)) {
    if (space.listed === undefined) return null;
    return space.listed
      ? { label: "Listed in Discover", open: true }
      : { label: "Unlisted · invite only", open: false };
  }
  return space.isPrivate ? { label: "Private", open: false } : { label: "Public", open: true };
}
