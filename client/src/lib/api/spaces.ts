import { api } from "./client";

interface Space {
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
  tags?: string[];
}

export async function listSpaces(opts?: { limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return api<Space[]>(`/spaces${qs ? `?${qs}` : ""}`);
}

export async function getSpace(id: string) {
  return api<Space>(`/spaces/${encodeURIComponent(id)}`, { priority: "low" });
}

/** Fetch all members of a space from the backend */
export async function fetchMembers(spaceId: string) {
  return api<Array<{ spaceId: string; pubkey: string; joinedAt: string }>>(
    `/spaces/${encodeURIComponent(spaceId)}/members`,
  );
}

/** Register a space in the backend database (must be called before roles/channels/invites) */
export async function registerSpace(params: {
  id: string;
  name: string;
  hostRelay: string;
  picture?: string;
  about?: string;
  mode?: "read" | "read-write";
  channels?: Array<{ type: string; label: string }>;
}) {
  return api<{ id: string }>("/spaces", { method: "POST", body: params });
}

/** Join a listed space (adds the current user as a member) */
export async function joinSpaceApi(id: string) {
  return api<{
    space: {
      id: string;
      name: string;
      picture: string | null;
      about: string | null;
      mode: "read" | "read-write";
      hostRelay: string;
      creatorPubkey: string | null;
      memberCount: number;
    };
    channels: Array<{
      id: string;
      spaceId: string;
      type: "chat" | "notes" | "media" | "articles" | "music" | "voice" | "video";
      label: string;
      position: number;
      isDefault: boolean;
      adminOnly: boolean;
      slowModeSeconds: number;
      temporary: boolean;
    }>;
    feedPubkeys: string[];
  }>(`/spaces/${encodeURIComponent(id)}/members/me`, { method: "POST" });
}

/** Leave a space (removes the current user from the member list) */
export async function leaveSpaceApi(id: string) {
  return api<{ left: boolean }>(`/spaces/${encodeURIComponent(id)}/members/me`, { method: "DELETE" });
}

/** Delete a space from the backend database */
export async function deleteSpaceApi(id: string) {
  return api<{ deleted: boolean }>(`/spaces/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Fetch all spaces the current user is a member of (recovery when cache is empty) */
export async function fetchMySpaces() {
  return api<Array<{
    space: {
      id: string;
      name: string;
      picture: string | null;
      about: string | null;
      mode: "read" | "read-write";
      hostRelay: string;
      creatorPubkey: string | null;
      memberCount: number;
    };
    channels: Array<{
      id: string;
      spaceId: string;
      type: "chat" | "notes" | "media" | "articles" | "music" | "voice" | "video";
      label: string;
      position: number;
      isDefault: boolean;
      adminOnly: boolean;
      slowModeSeconds: number;
      temporary: boolean;
    }>;
    feedPubkeys: string[];
  }>>("/spaces/my-spaces");
}

/** Check which space IDs still exist on the backend (for stale cache cleanup) */
export async function validateSpaces(ids: string[]) {
  return api<{ existing: string[]; deleted: string[] }>("/spaces/validate", {
    method: "POST",
    body: { ids },
  });
}

// ── Feed Sources ──────────────────────────────────────────────────

/** Fetch curated feed source pubkeys for a space */
export async function fetchFeedSources(spaceId: string) {
  return api<string[]>(`/spaces/${encodeURIComponent(spaceId)}/feed-sources`);
}

/** Add pubkeys as feed sources (admin only) */
export async function addFeedSources(spaceId: string, pubkeys: string[]) {
  return api<string[]>(`/spaces/${encodeURIComponent(spaceId)}/feed-sources`, {
    method: "POST",
    body: { pubkeys },
  });
}

/** Remove a feed source pubkey (admin only) */
export async function removeFeedSource(spaceId: string, pubkey: string) {
  return api<{ removed: boolean }>(
    `/spaces/${encodeURIComponent(spaceId)}/feed-sources/${encodeURIComponent(pubkey)}`,
    { method: "DELETE" },
  );
}
