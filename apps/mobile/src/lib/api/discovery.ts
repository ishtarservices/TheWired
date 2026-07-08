// Public spaces directory — the backend's discovery API through the gateway
// (services/backend/src/routes/discovery.ts). GET /discovery/spaces is a
// public endpoint: the gateway passes unauthenticated requests through and
// the route requires no pubkey, so guests browse it too (5.1.1(v)).
//
// Plain fetch: this is our own API host (env-resolved — local gateway in
// dev, thewired.app in release; see lib/env.ts) — the HttpAdapter's
// redirect-control contract exists for UNTRUSTED URLs (LNURL etc.), not
// first-party calls.

import { API_BASE } from "@/lib/env";

export { API_BASE };

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

export interface DirectoryQuery {
  sort?: DirectorySort;
  limit?: number;
  /** Category slug from `fetchCategories` — filters `spaces.category`. */
  category?: string;
  search?: string;
  offset?: number;
}

/** A discovery category row (backend keys these by slug, not id). */
export interface SpaceCategory {
  slug: string;
  name: string;
  spaceCount: number;
}

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

export async function fetchListedSpaces(options: DirectoryQuery = {}): Promise<ListedSpace[]> {
  const params = new URLSearchParams({
    sort: options.sort ?? "trending",
    limit: String(options.limit ?? 50),
  });
  if (options.category) params.set("category", options.category);
  if (options.search) params.set("search", options.search);
  if (options.offset) params.set("offset", String(options.offset));
  const response = await fetch(`${API_BASE}/discovery/spaces?${params}`);
  if (!response.ok) {
    throw new Error(`Directory unavailable (${response.status})`);
  }
  return parseListedSpaces(await response.json());
}

/** Curated top-12 featured spaces (GET /discovery/spaces/featured). */
export async function fetchFeaturedSpaces(): Promise<ListedSpace[]> {
  const response = await fetch(`${API_BASE}/discovery/spaces/featured`);
  if (!response.ok) {
    throw new Error(`Featured unavailable (${response.status})`);
  }
  return parseListedSpaces(await response.json());
}

export function parseCategories(payload: unknown): SpaceCategory[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const out: SpaceCategory[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.slug !== "string" || typeof obj.name !== "string") continue;
    out.push({
      slug: obj.slug,
      name: obj.name,
      spaceCount: typeof obj.spaceCount === "number" ? obj.spaceCount : 0,
    });
  }
  return out;
}

export async function fetchCategories(): Promise<SpaceCategory[]> {
  const response = await fetch(`${API_BASE}/discovery/categories`);
  if (!response.ok) {
    throw new Error(`Categories unavailable (${response.status})`);
  }
  return parseCategories(await response.json());
}
