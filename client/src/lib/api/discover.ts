import { api } from "./client";

export interface DiscoverSpace {
  id: string;
  hostRelay: string;
  name: string;
  picture: string | null;
  about: string | null;
  category: string | null;
  memberCount: number;
  activeMembers24h: number;
  messagesLast24h: number;
  featured: boolean;
  listed: boolean;
  discoveryScore: number;
  creatorPubkey: string | null;
  createdAt: number;
  tags: string[];
}

export interface SpaceCategory {
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
  spaceCount: number;
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

// ── Space discovery ──────────────────────────────────────────────

export async function discoverSpaces(opts?: {
  category?: string;
  tag?: string;
  sort?: "trending" | "newest" | "popular";
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (opts?.category) params.set("category", opts.category);
  if (opts?.tag) params.set("tag", opts.tag);
  if (opts?.sort) params.set("sort", opts.sort);
  if (opts?.search) params.set("search", opts.search);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return api<DiscoverSpace[]>(`/discovery/spaces${qs ? `?${qs}` : ""}`, { auth: false });
}

export async function discoverFeaturedSpaces() {
  return api<DiscoverSpace[]>("/discovery/spaces/featured", { auth: false });
}

// ── Categories ──────────────────────────────────────────────────

export async function getDiscoverCategories() {
  return api<SpaceCategory[]>("/discovery/categories", { auth: false });
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
