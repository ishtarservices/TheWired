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
  return api<Space>(`/spaces/${encodeURIComponent(id)}`);
}
