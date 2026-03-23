import { api } from "./client";
import type { GifItem } from "@/types/emoji";

interface GifSearchResult {
  results: GifItem[];
  next: string;
}

/** Fetch trending GIFs */
export async function getTrendingGifs(limit = 20, pos?: string): Promise<GifSearchResult> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (pos) params.set("pos", pos);
  const res = await api<GifSearchResult>(`/gif/trending?${params}`, { auth: false });
  return res.data;
}

/** Search GIFs by query */
export async function searchGifs(query: string, limit = 20, pos?: string): Promise<GifSearchResult> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (pos) params.set("pos", pos);
  const res = await api<GifSearchResult>(`/gif/search?${params}`, { auth: false });
  return res.data;
}

/** Get autocomplete suggestions for GIF search */
export async function getGifAutocomplete(query: string): Promise<string[]> {
  const params = new URLSearchParams({ q: query });
  const res = await api<string[]>(`/gif/autocomplete?${params}`, { auth: false });
  return res.data;
}

/** Register a share event (API TOS compliance) */
export async function registerGifShare(id: string, searchTerm?: string): Promise<void> {
  await api("/gif/register-share", {
    method: "POST",
    body: { id, searchTerm },
    auth: false,
  });
}
