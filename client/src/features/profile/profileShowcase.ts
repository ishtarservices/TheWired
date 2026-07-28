// Profile showcase model now lives in @thewired/core so desktop and mobile
// share one definition (see packages/core/src/nostr/profileShowcase.ts). This
// module is a thin re-export shim kept so existing `./profileShowcase` imports
// across the client don't need to change.
export type { ShowcaseItem, ProfileShowcase } from "@thewired/core";
export {
  SHOWCASE_D_TAG,
  MAX_SHOWCASE_ITEMS,
  DEFAULT_SHOWCASE,
  getCachedShowcase,
  getCachedShowcaseTimestamp,
  cacheShowcase,
  invalidateShowcaseCache,
  parseShowcase,
  buildShowcaseEvent,
} from "@thewired/core";
