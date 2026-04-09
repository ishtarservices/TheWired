/**
 * Sanitize a display name / username into a valid NIP-05 local part.
 *
 * Rules:
 *  - Lowercase everything
 *  - Whitespace → hyphens
 *  - Strip anything that isn't a-z, 0-9, hyphen, underscore, or dot
 *  - Collapse consecutive hyphens / underscores / dots
 *  - Trim leading/trailing special characters
 */
export function sanitizeNip05Username(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[-]{2,}/g, "-")
    .replace(/[.]{2,}/g, ".")
    .replace(/[_]{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "");
}

/**
 * Strip characters that are never valid in a NIP-05 identifier (user@domain).
 * Used for the raw input field so the user can type freely but spaces
 * and uppercase are normalized on the fly.
 */
export function sanitizeNip05Input(raw: string): string {
  return raw.replace(/\s/g, "").toLowerCase();
}
