// Public spaces directory — the backend's discovery API through the gateway
// (services/backend/src/routes/discovery.ts). GET /discovery/spaces is a
// public endpoint: the gateway passes unauthenticated requests through and
// the route requires no pubkey, so guests browse it too (5.1.1(v)).
//
// Plain fetch: this is our own fixed API host — the HttpAdapter's redirect-
// control contract exists for UNTRUSTED URLs (LNURL etc.), not first-party
// calls.

export const API_BASE = "https://api.thewired.app/api";

/** The slice of app.spaces the directory screen renders. */
export interface ListedSpace {
  id: string;
  name: string;
  about: string | null;
  picture: string | null;
  category: string | null;
  hostRelay: string | null;
  spaceMode: "platform" | "alite" | "nip29" | string;
  memberCount: number;
  activeMembers24h: number;
  featured: boolean;
  tags: string[];
}

export type DirectorySort = "trending" | "newest" | "popular";

function asListedSpace(raw: unknown): ListedSpace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;
  return {
    id: obj.id,
    name: obj.name,
    about: typeof obj.about === "string" ? obj.about : null,
    picture: typeof obj.picture === "string" ? obj.picture : null,
    category: typeof obj.category === "string" ? obj.category : null,
    hostRelay: typeof obj.hostRelay === "string" ? obj.hostRelay : null,
    spaceMode: typeof obj.spaceMode === "string" ? obj.spaceMode : "platform",
    memberCount: typeof obj.memberCount === "number" ? obj.memberCount : 0,
    activeMembers24h: typeof obj.activeMembers24h === "number" ? obj.activeMembers24h : 0,
    featured: obj.featured === true,
    tags: Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === "string") : [],
  };
}

/** Parse the `{data: [...]}` envelope defensively (server is trusted-ish,
 *  but a shape change must degrade to an empty list, not a crash). */
export function parseListedSpaces(payload: unknown): ListedSpace[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.map(asListedSpace).filter((s): s is ListedSpace => s !== null);
}

export async function fetchListedSpaces(
  options: { sort?: DirectorySort; limit?: number } = {},
): Promise<ListedSpace[]> {
  const params = new URLSearchParams({
    sort: options.sort ?? "trending",
    limit: String(options.limit ?? 50),
  });
  const response = await fetch(`${API_BASE}/discovery/spaces?${params}`);
  if (!response.ok) {
    throw new Error(`Directory unavailable (${response.status})`);
  }
  return parseListedSpaces(await response.json());
}
