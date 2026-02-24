import type { NostrEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";

/** Parse kind:0 event content into a profile */
export function parseProfile(event: NostrEvent): Kind0Profile | null {
  if (event.kind !== 0) return null;

  try {
    const data = JSON.parse(event.content);
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      display_name:
        typeof data.display_name === "string" ? data.display_name : undefined,
      about: typeof data.about === "string" ? data.about : undefined,
      picture: typeof data.picture === "string" ? data.picture : undefined,
      banner: typeof data.banner === "string" ? data.banner : undefined,
      nip05: typeof data.nip05 === "string" ? data.nip05 : undefined,
      lud16: typeof data.lud16 === "string" ? data.lud16 : undefined,
      website: typeof data.website === "string" ? data.website : undefined,
    };
  } catch {
    return null;
  }
}
