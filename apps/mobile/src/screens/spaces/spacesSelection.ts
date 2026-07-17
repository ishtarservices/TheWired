// The SpacesHome switcher selection — feed or one joined space. Persisted
// as JSON through appPrefs so the last-viewed space restores across cold
// starts; a stored space the account no longer belongs to collapses back to
// feed via the existing not-in-mySpaces fallback in SpacesHomeScreen.

export type SpaceSelection = { kind: "feed" } | { kind: "space"; spaceId: string };

export function serializeSpaceSelection(selection: SpaceSelection): string {
  return JSON.stringify(selection);
}

/** Defensive parse — anything malformed yields null (caller falls back to feed). */
export function parseSpaceSelection(raw: string | null | undefined): SpaceSelection | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const kind = (value as { kind?: unknown }).kind;
    if (kind === "feed") return { kind: "feed" };
    if (kind === "space") {
      const spaceId = (value as { spaceId?: unknown }).spaceId;
      if (typeof spaceId === "string" && spaceId.length > 0) {
        return { kind: "space", spaceId };
      }
    }
    return null;
  } catch {
    return null;
  }
}
