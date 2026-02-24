import { api } from "./client";

interface SearchResult {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  created_at: number;
}

export async function search(query: string, opts?: { kind?: number; limit?: number; offset?: number }) {
  const params = new URLSearchParams({ q: query });
  if (opts?.kind != null) params.set("kind", String(opts.kind));
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  return api<SearchResult[]>(`/search?${params.toString()}`, { auth: false });
}
