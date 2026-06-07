import type { Kind0Profile } from "../../types/profile";

/** The kind:0 fields the profile editors expose as inputs. Other fields (lud06,
 *  custom keys) are NOT edited here — they ride through unchanged via the
 *  read-modify-write base merge in buildProfileEvent. */
export const PROFILE_FORM_FIELDS = [
  "name",
  "display_name",
  "about",
  "picture",
  "banner",
  "nip05",
  "lud16",
  "website",
] as const;

export type ProfileFormField = (typeof PROFILE_FORM_FIELDS)[number];

/** Build the editable form object from a profile (missing fields → ""). */
export function profileToForm(profile: Kind0Profile | null | undefined): Kind0Profile {
  const form: Kind0Profile = {};
  for (const f of PROFILE_FORM_FIELDS) form[f] = profile?.[f] ?? "";
  return form;
}

/**
 * Re-sync a form with a freshly-loaded/updated profile while preserving the
 * fields the user has already edited (`touched`).
 *
 * This is the crux of the cold-login race fix: a field the user HASN'T touched
 * is refilled from `incoming`, so a half-edited form still picks up the rest of
 * the real profile. If it left those blank, the save path (buildProfileEvent
 * merging the form over the base) would publish them as empty strings — wiping
 * the user's real name/about/lud16/etc. on every relay.
 */
export function syncProfileForm(
  prev: Kind0Profile,
  incoming: Kind0Profile,
  touched: ReadonlySet<ProfileFormField>,
): Kind0Profile {
  const next: Kind0Profile = {};
  for (const f of PROFILE_FORM_FIELDS) {
    next[f] = touched.has(f) ? (prev[f] ?? "") : (incoming[f] ?? "");
  }
  return next;
}
