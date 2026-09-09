// Segment vocabulary + persistence for the Discover shell. Pure apart from the
// localStorage seam, which is wrapped so a blocked storage never throws into
// render.

export type DiscoverSegment = "spaces" | "music" | "people";

export const SEGMENTS: { value: DiscoverSegment; label: string }[] = [
  { value: "spaces", label: "Spaces" },
  { value: "music", label: "Music" },
  { value: "people", label: "People" },
];

export const PLACEHOLDERS: Record<DiscoverSegment, string> = {
  spaces: "Search spaces",
  music: "Search tracks and albums",
  people: "Search people",
};

export const SEGMENT_STORAGE_KEY = "discover.segment";

/** Wrong/legacy values (e.g. the retired "relays" tab) fall back to null so
 *  the caller can choose the default. */
export function parseSegment(raw: string | null | undefined): DiscoverSegment | null {
  return raw === "spaces" || raw === "music" || raw === "people" ? raw : null;
}

export function readStoredSegment(): DiscoverSegment | null {
  try {
    return parseSegment(localStorage.getItem(SEGMENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function storeSegment(segment: DiscoverSegment): void {
  try {
    localStorage.setItem(SEGMENT_STORAGE_KEY, segment);
  } catch {
    // Storage blocked — the URL still carries the segment for this visit.
  }
}

/** Route param wins over storage; storage wins over the default. */
export function resolveInitialSegment(routeParam: string | null): DiscoverSegment {
  return parseSegment(routeParam) ?? readStoredSegment() ?? "spaces";
}
