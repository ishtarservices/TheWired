// kind-0 profile parsing — moved to @thewired/core (Phase 0), single-sourced
// with the desktop parser: content is attacker-controlled JSON, so it rejects
// non-objects, strips prototype-clobbering keys, and (new vs the old mobile
// copy) preserves unmodeled fields so a future republish never drops them.

import type { ParsedProfile } from "@thewired/core";

export { parseProfile, profileDisplayName } from "@thewired/core";

/** Mobile's historical name for the parsed kind-0 shape. */
export type ProfileMetadata = ParsedProfile;
