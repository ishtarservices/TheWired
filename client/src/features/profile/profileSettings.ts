// Profile display settings now live in @ishtarservices/core so desktop and mobile
// share one definition (see packages/core/src/nostr/profileSettings.ts). This
// module is a thin re-export shim kept so existing `./profileSettings` imports
// across the client don't need to change.
export type { ProfileTab, ProfileSettings } from "@ishtarservices/core";
export {
  ALL_TABS,
  DEFAULT_PROFILE_SETTINGS,
  D_TAG,
  getCachedSettings,
  getCachedEventTimestamp,
  cacheSettings,
  invalidateCache,
  parseProfileSettings,
  buildProfileSettingsEvent,
} from "@ishtarservices/core";
