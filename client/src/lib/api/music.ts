import { getApiBaseUrl } from "./client";
import { buildNip98Header } from "./nip98";
import type { TrackInsights, ArtistSummary } from "@/types/music";

interface UploadAudioResponse {
  url: string;
  sha256: string;
  size: number;
  mimeType: string;
  duration?: number;
}

interface UploadCoverResponse {
  url: string;
}

/**
 * Upload an audio file to the backend.
 * Uses multipart/form-data so we skip the JSON api() helper.
 */
export async function uploadAudio(
  file: File,
  metadata?: { title?: string; artist?: string },
): Promise<UploadAudioResponse> {
  const url = `${getApiBaseUrl()}/music/upload`;
  const form = new FormData();
  form.append("file", file);
  if (metadata?.title) form.append("title", metadata.title);
  if (metadata?.artist) form.append("artist", metadata.artist);

  const headers: Record<string, string> = {};
  headers["Authorization"] = await buildNip98Header(url, "POST");

  const res = await fetch(url, { method: "POST", headers, body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  const json = await res.json();
  return json.data as UploadAudioResponse;
}

/**
 * Upload a cover art image.
 */
export async function uploadCoverArt(file: File): Promise<UploadCoverResponse> {
  const url = `${getApiBaseUrl()}/music/upload/cover`;
  const form = new FormData();
  form.append("file", file);

  const headers: Record<string, string> = {};
  headers["Authorization"] = await buildNip98Header(url, "POST");

  const res = await fetch(url, { method: "POST", headers, body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
  const json = await res.json();
  return json.data as UploadCoverResponse;
}

interface MusicUploadRecord {
  id: string;
  pubkey: string;
  originalFilename: string;
  url: string;
  sha256: string;
  mimeType: string;
  fileSize: number;
  duration: number | null;
  createdAt: string;
}

/**
 * Get the current user's uploads.
 */
export async function getMyUploads(
  opts?: { limit?: number; offset?: number },
): Promise<{ data: MusicUploadRecord[] }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));

  const url = `${getApiBaseUrl()}/music/uploads${params.toString() ? `?${params}` : ""}`;

  const headers: Record<string, string> = {};
  headers["Authorization"] = await buildNip98Header(url, "GET");

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Failed to fetch uploads: ${res.statusText}`);
  return res.json();
}

export type AudioVariantStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "skipped"
  | "unknown";

export interface AudioVariants {
  status: AudioVariantStatus;
  hlsMaster?: string;
  loudnessI?: number | null;
}

/**
 * Look up transcoded variants for a raw audio blob by its sha256.
 * Returns null on network/server error — callers should fall back to the
 * original URL. Never throws.
 */
export async function getAudioVariants(sha256: string): Promise<AudioVariants | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  try {
    const res = await fetch(`${getApiBaseUrl()}/music/variants/${sha256}`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data as AudioVariants;
  } catch {
    return null;
  }
}

/**
 * Report a play event for a track (fire-and-forget).
 */
export async function reportPlay(addressableId: string): Promise<void> {
  const url = `${getApiBaseUrl()}/music/play`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  headers["Authorization"] = await buildNip98Header(url, "POST");

  fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ trackId: addressableId }),
  }).catch(() => {
    // fire-and-forget, don't block playback
  });
}

export async function getTrendingTracks(
  opts?: { period?: string; limit?: number },
): Promise<{ data: unknown[] }> {
  const params = new URLSearchParams();
  params.set("kind", "31683");
  if (opts?.period) params.set("period", opts.period);
  if (opts?.limit) params.set("limit", String(opts.limit));

  const res = await fetch(
    `${getApiBaseUrl()}/feeds/trending?${params.toString()}`,
  );
  if (!res.ok) throw new Error("Failed to fetch trending tracks");
  return res.json();
}

export async function getTrendingAlbums(
  opts?: { period?: string; limit?: number },
): Promise<{ data: unknown[] }> {
  const params = new URLSearchParams();
  params.set("kind", "33123");
  if (opts?.period) params.set("period", opts.period);
  if (opts?.limit) params.set("limit", String(opts.limit));

  const res = await fetch(
    `${getApiBaseUrl()}/feeds/trending?${params.toString()}`,
  );
  if (!res.ok) throw new Error("Failed to fetch trending albums");
  return res.json();
}

interface ResolveAlbumResponse {
  event: unknown;
  tracks?: unknown[];
}

interface ResolveTrackResponse {
  event: unknown;
}

/**
 * Resolve a music item by type/pubkey/slug. Public endpoint, no auth required.
 */
export async function resolveMusic(
  type: "album" | "track",
  pubkey: string,
  slug: string,
): Promise<{ data: ResolveAlbumResponse | ResolveTrackResponse }> {
  const url = `${getApiBaseUrl()}/music/resolve/${type}/${pubkey}/${encodeURIComponent(slug)}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) throw new Error("Not found");
    throw new Error(`Resolve failed: ${res.statusText}`);
  }
  return res.json();
}

export async function getGenres(): Promise<{ data: { genre: string; count: number }[] }> {
  const res = await fetch(`${getApiBaseUrl()}/music/genres`);
  if (!res.ok) throw new Error("Failed to fetch genres");
  return res.json();
}

export async function getPopularTags(
  limit = 20,
): Promise<{ data: { tag: string; count: number }[] }> {
  const res = await fetch(`${getApiBaseUrl()}/music/tags/popular?limit=${limit}`);
  if (!res.ok) throw new Error("Failed to fetch tags");
  return res.json();
}

export async function browseMusic(params: {
  genre?: string;
  tag?: string;
  sort?: "trending" | "recent" | "plays";
  limit?: number;
  offset?: number;
}): Promise<{ data: { tracks: unknown[]; total: number } }> {
  const qs = new URLSearchParams();
  if (params.genre) qs.set("genre", params.genre);
  if (params.tag) qs.set("tag", params.tag);
  if (params.sort) qs.set("sort", params.sort);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));

  const res = await fetch(`${getApiBaseUrl()}/music/browse?${qs.toString()}`);
  if (!res.ok) throw new Error("Failed to browse music");
  return res.json();
}

export async function browseAlbums(params: {
  genre?: string;
  tag?: string;
  sort?: "trending" | "recent" | "plays";
  limit?: number;
  offset?: number;
}): Promise<{ data: { albums: unknown[]; total: number } }> {
  const qs = new URLSearchParams();
  if (params.genre) qs.set("genre", params.genre);
  if (params.tag) qs.set("tag", params.tag);
  if (params.sort) qs.set("sort", params.sort);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));

  const res = await fetch(`${getApiBaseUrl()}/music/browse/albums?${qs.toString()}`);
  if (!res.ok) throw new Error("Failed to browse albums");
  return res.json();
}

export async function getUnderground(_opts?: { genre?: string; limit?: number }) {
  // TODO: Phase 4
  return { data: [] };
}

export async function getRecommended(_opts?: { limit?: number }) {
  // TODO: Phase 5
  return { data: [] };
}

/**
 * Delete a music item (track or album) from the backend.
 * The backend verifies that the authenticated pubkey matches the content author.
 */
export async function deleteMusic(
  type: "track" | "album",
  pubkey: string,
  slug: string,
): Promise<void> {
  const url = `${getApiBaseUrl()}/music/${type}/${pubkey}/${encodeURIComponent(slug)}`;
  const headers: Record<string, string> = {};
  headers["Authorization"] = await buildNip98Header(url, "DELETE");

  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Delete failed: ${res.statusText}`);
  }
}

/**
 * Rebuild genre/tag counts from scratch (fixes stale Redis counters).
 */
export async function rebuildMusicCounts(): Promise<{ data: { genres: number; tags: number; tracksAndAlbums: number } }> {
  const url = `${getApiBaseUrl()}/music/rebuild-counts`;
  const headers: Record<string, string> = {};
  headers["Authorization"] = await buildNip98Header(url, "POST");

  const res = await fetch(url, { method: "POST", headers });
  if (!res.ok) throw new Error(`Rebuild failed: ${res.statusText}`);
  return res.json();
}

export async function searchMusic(
  query: string,
): Promise<{ data: unknown[] }> {
  const res = await fetch(
    `${getApiBaseUrl()}/search/music?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error("Failed to search music");
  return res.json();
}

/**
 * Fetch play insights for a specific track or album.
 */
export async function getTrackInsights(
  addressableId: string,
): Promise<{ data: TrackInsights }> {
  const url = `${getApiBaseUrl()}/music/insights/${addressableId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch insights");
  return res.json();
}

/**
 * Fetch artist-level summary (total plays, listeners, track breakdown).
 * Requires authentication (NIP-98).
 */
export async function getArtistSummary(): Promise<{ data: ArtistSummary }> {
  const url = `${getApiBaseUrl()}/music/insights-summary`;
  const headers: Record<string, string> = {};
  headers["Authorization"] = await buildNip98Header(url, "GET");

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("Failed to fetch artist summary");
  return res.json();
}
