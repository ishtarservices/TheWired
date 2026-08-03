// Moved to @ishtarservices/core (Phase 0) — one hardened kind:0 parser shared with
// mobile. Core's ParsedProfile is structurally a Kind0Profile (all modeled
// fields match; unknown fields are preserved at runtime for republish).
import { parseProfile as coreParseProfile } from "@ishtarservices/core";
import type { NostrEvent } from "../../types/nostr";
import type { Kind0Profile } from "../../types/profile";

/** Parse kind:0 event content into a profile */
export function parseProfile(event: NostrEvent): Kind0Profile | null {
  return coreParseProfile(event);
}
