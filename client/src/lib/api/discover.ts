import { api } from "./client";

// Public spaces directory — the backend's discovery API through the gateway
// (services/backend/src/routes/discovery.ts). Every read here is public
// (`auth: false`): the gateway passes unauthenticated requests through.
//
// The parsers are defensive on purpose: a shape change server-side must
// degrade to an empty list or a defaulted field, never to a crash or a NaN
// painted into a row.

/** The slice of app.spaces the directory renders. */
export interface DiscoverSpace {
  id: string;
  hostRelay: string | null;
  name: string;
  picture: string | null;
  about: string | null;
  category: string | null;
  /** `read` = feed-only (no chat); `read-write` = a full space. */
  mode: "read" | "read-write";
  /** "platform" | "alite" | "nip29" — free string; the backend owns the vocabulary. */
  spaceMode: string;
  memberCount: number;
  activeMembers24h: number;
  /** Chat volume in the last 24h — the honest "is anyone here" number. */
  messagesLast24h: number;
  featured: boolean;
  listed: boolean;
  /** The backend's blended rank; carries a zap term since the zap rollup landed. */
  discoveryScore: number;
  /** Zap receipts against this space's events in the last 24h (rolling window). */
  zapCount24h: number;
  /** Sats behind those receipts. */
  zapSats24h: number;
  /** BCP-47-ish hint from the backend, or null when unset. */
  language: string | null;
  /** Mirrored in from elsewhere on the network rather than native here. */
  externalOrigin: boolean;
  creatorPubkey: string | null;
  /** ms epoch when the space was listed, or null. */
  listedAt: number | null;
  /** ms epoch when the space was created, or null. */
  createdAt: number | null;
  tags: string[];
}

export type DiscoverSort = "trending" | "newest" | "popular";

/** A discovery category row (backend keys these by slug, not id). */
export interface SpaceCategory {
  slug: string;
  name: string;
  description: string | null;
  /** Lucide component name as the backend spells it ("Gamepad2"). Resolved
   *  client-side by features/discover/categoryIcons.ts; unknown → Boxes. */
  icon: string | null;
  /** Backend ordering — ties in the tile grid break on it. */
  position: number;
  spaceCount: number;
}

/** A scene: one browse chip that means the same thing for spaces (tags) and
 *  music (genres). Served by GET /discovery/scenes; features/discover/taxonomy.ts
 *  carries the offline fallback. */
export interface Scene {
  slug: string;
  label: string;
  description: string | null;
  /** Genre strings as /music/genres reports them — matched case-insensitively. */
  genres: string[];
  /** Space/hashtag tokens — sent verbatim as the `tag` OR-list. */
  tags: string[];
  /** Listed spaces currently matching (upper bound). 0 = "offer no chip for this". */
  spaceCount: number;
  position: number;
}

export interface DiscoverRelay {
  url: string;
  name: string | null;
  description: string | null;
  supportedNips: number[] | null;
  isPaid: boolean;
  requiresAuth: boolean;
  rttMs: number | null;
  userCount: number;
}

export interface ListingRequest {
  id: string;
  spaceId: string;
  requesterPubkey: string;
  status: "pending" | "approved" | "rejected";
  category: string | null;
  tags: string[] | null;
  reason: string | null;
  reviewerPubkey: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

// ── Parsers ─────────────────────────────────────────────────────

/** The API is inconsistent here: `createdAt` arrives as an ms-epoch number,
 *  `listedAt` as an ISO string. Accept either, null on anything else. */
function asEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function asDiscoverSpace(raw: unknown): DiscoverSpace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return null;
  return {
    id: obj.id,
    name: obj.name,
    hostRelay: str(obj.hostRelay),
    picture: str(obj.picture),
    about: str(obj.about),
    category: str(obj.category),
    // Unknown/garbage mode reads as a full space — the conservative default is
    // to NOT badge something "feed only" when we can't tell.
    mode: obj.mode === "read" ? "read" : "read-write",
    spaceMode: str(obj.spaceMode) ?? "platform",
    memberCount: num(obj.memberCount),
    activeMembers24h: num(obj.activeMembers24h),
    messagesLast24h: num(obj.messagesLast24h),
    featured: obj.featured === true,
    listed: obj.listed !== false,
    discoveryScore: num(obj.discoveryScore),
    zapCount24h: num(obj.zapCount24h),
    zapSats24h: num(obj.zapSats24h),
    language: str(obj.language),
    externalOrigin: obj.externalOrigin === true,
    creatorPubkey: str(obj.creatorPubkey),
    listedAt: asEpochMs(obj.listedAt),
    createdAt: asEpochMs(obj.createdAt),
    tags: strings(obj.tags),
  };
}

/** Parse a `{data: [...]}` envelope (or a bare array) into directory rows. */
export function parseDiscoverSpaces(payload: unknown): DiscoverSpace[] {
  const data = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null
      ? (payload as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) return [];
  return data.map(asDiscoverSpace).filter((s): s is DiscoverSpace => s !== null);
}

export function parseCategories(payload: unknown): SpaceCategory[] {
  const data = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null
      ? (payload as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) return [];
  const out: SpaceCategory[] = [];
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.slug !== "string" || typeof obj.name !== "string") continue;
    out.push({
      slug: obj.slug,
      name: obj.name,
      spaceCount: num(obj.spaceCount),
      icon: str(obj.icon),
      description: str(obj.description),
      position: num(obj.position),
    });
  }
  // Position, not arrival — same contract as parseScenes.
  return out.sort((a, b) => a.position - b.position);
}

function asScene(raw: unknown): Scene | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.slug !== "string" || typeof obj.label !== "string") return null;
  return {
    slug: obj.slug,
    label: obj.label,
    description: str(obj.description),
    genres: strings(obj.genres),
    tags: strings(obj.tags),
    spaceCount: num(obj.spaceCount),
    position: num(obj.position),
  };
}

export function parseScenes(payload: unknown): Scene[] {
  const data = Array.isArray(payload)
    ? payload
    : typeof payload === "object" && payload !== null
      ? (payload as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data)) return [];
  return data
    .map(asScene)
    .filter((s): s is Scene => s !== null)
    .sort((a, b) => a.position - b.position);
}

// ── Space discovery ──────────────────────────────────────────────

export interface DiscoverSpacesQuery {
  category?: string;
  /** Freeform space tags — sent as a comma-separated OR list, which lets one
   *  scene span several tags server-side. Max 500 chars server-side. */
  tag?: string[];
  sort?: DiscoverSort;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function discoverSpaces(
  opts: DiscoverSpacesQuery = {},
): Promise<{ data: DiscoverSpace[] }> {
  const params = new URLSearchParams();
  if (opts.category) params.set("category", opts.category);
  if (opts.tag?.length) params.set("tag", opts.tag.join(","));
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.search) params.set("search", opts.search);
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  const res = await api<unknown>(`/discovery/spaces${qs ? `?${qs}` : ""}`, { auth: false });
  return { data: parseDiscoverSpaces(res.data) };
}

/** Curated list. Exists server-side; nothing in the client should consume it
 *  as a rail — a curated row above a ranked list that already explains every
 *  row is a second authority. Kept for a future "hand-picked" byline. */
export async function discoverFeaturedSpaces(): Promise<{ data: DiscoverSpace[] }> {
  const res = await api<unknown>("/discovery/spaces/featured", { auth: false });
  return { data: parseDiscoverSpaces(res.data) };
}

// ── Categories / scenes ─────────────────────────────────────────

export async function getDiscoverCategories(): Promise<{ data: SpaceCategory[] }> {
  const res = await api<unknown>("/discovery/categories", { auth: false });
  return { data: parseCategories(res.data) };
}

export async function discoverScenes(): Promise<{ data: Scene[] }> {
  const res = await api<unknown>("/discovery/scenes", { auth: false });
  return { data: parseScenes(res.data) };
}

// ── Listing requests ────────────────────────────────────────────

export async function submitListingRequest(params: {
  spaceId: string;
  category?: string;
  tags?: string[];
  reason?: string;
}) {
  return api<{ id: string; status: string }>("/discovery/listing-requests", {
    method: "POST",
    body: params,
  });
}

export async function getListingRequests() {
  return api<ListingRequest[]>("/discovery/listing-requests");
}

export async function reviewListingRequest(
  id: string,
  params: { status: "approved" | "rejected"; reviewNote?: string },
) {
  return api<{ requestId: string; status: string }>(
    `/discovery/listing-requests/${encodeURIComponent(id)}`,
    { method: "PATCH", body: params },
  );
}

// ── Relay discovery ─────────────────────────────────────────────

export async function discoverRelays(opts?: {
  sort?: "popular" | "fastest" | "newest";
  nip?: number;
  search?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.nip) params.set("nip", String(opts.nip));
  if (opts?.search) params.set("search", opts.search);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return api<DiscoverRelay[]>(`/discovery/relays${qs ? `?${qs}` : ""}`, { auth: false });
}
