import { getApiBaseUrl } from "./client";
import { buildNip98Header } from "./nip98";

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

export async function searchMusic(
  query: string,
): Promise<{ data: unknown[] }> {
  const res = await fetch(
    `${getApiBaseUrl()}/search/music?q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) throw new Error("Failed to search music");
  return res.json();
}
