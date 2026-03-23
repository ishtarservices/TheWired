import { config } from "../config.js";
import { getRedis } from "../lib/redis.js";

const GIF_API_BASE = process.env.GIF_API_BASE ?? "https://api.klipy.com/v2";

export interface GifDto {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface GifSearchResult {
  results: GifDto[];
  next: string;
}

/** Cache TTLs in seconds */
const TTL = {
  trending: 60,
  search: 300,
  autocomplete: 600,
} as const;

function gifApiKey(): string {
  return config.gifApiKey;
}

function gifClientKey(): string {
  return config.gifClientKey;
}

/** Build API URL with default params */
function buildUrl(endpoint: string, params: Record<string, string>): string {
  const key = gifApiKey();
  if (!key) {
    throw new Error(
      "GIF_API_KEY is not configured. Get a free API key from https://klipy.com and set GIF_API_KEY in your .env file.",
    );
  }
  const url = new URL(`${GIF_API_BASE}/${endpoint}`);
  url.searchParams.set("key", key);
  url.searchParams.set("client_key", gifClientKey());
  url.searchParams.set("contentfilter", "medium");
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

/** Transform Tenor/Klipy response objects into minimal DTOs */
function transformResults(results: TenorResult[]): GifDto[] {
  return results.map((r) => {
    const gif = r.media_formats?.gif;
    const tiny = r.media_formats?.tinygif;
    return {
      id: r.id,
      title: r.title || r.content_description || "",
      url: gif?.url ?? tiny?.url ?? "",
      previewUrl: tiny?.url ?? gif?.url ?? "",
      width: gif?.dims?.[0] ?? tiny?.dims?.[0] ?? 0,
      height: gif?.dims?.[1] ?? tiny?.dims?.[1] ?? 0,
    };
  });
}

/** Raw Tenor/Klipy API response types */
interface TenorMediaObject {
  url: string;
  dims: [number, number];
  size: number;
  duration: number;
}

interface TenorResult {
  id: string;
  title: string;
  content_description: string;
  media_formats: Record<string, TenorMediaObject>;
}

interface TenorSearchResponse {
  results: TenorResult[];
  next: string;
}

/** Fetch trending GIFs */
export async function getTrendingGifs(limit = 20, pos?: string): Promise<GifSearchResult> {
  const cacheKey = `gif:trending:${limit}:${pos ?? "0"}`;
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = buildUrl("featured", { limit: String(limit), ...(pos ? { pos } : {}) });
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GIF API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as TenorSearchResponse;
  const result: GifSearchResult = {
    results: transformResults(data.results ?? []),
    next: data.next || "",
  };

  await redis.setex(cacheKey, TTL.trending, JSON.stringify(result));
  return result;
}

/** Search GIFs by query */
export async function searchGifs(query: string, limit = 20, pos?: string): Promise<GifSearchResult> {
  const cacheKey = `gif:search:${query}:${limit}:${pos ?? "0"}`;
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = buildUrl("search", { q: query, limit: String(limit), ...(pos ? { pos } : {}) });
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GIF API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as TenorSearchResponse;
  const result: GifSearchResult = {
    results: transformResults(data.results ?? []),
    next: data.next || "",
  };

  await redis.setex(cacheKey, TTL.search, JSON.stringify(result));
  return result;
}

/** Get autocomplete suggestions */
export async function getAutocomplete(query: string): Promise<string[]> {
  const cacheKey = `gif:ac:${query}`;
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = buildUrl("autocomplete", { q: query });
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GIF API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { results: string[] };
  await redis.setex(cacheKey, TTL.autocomplete, JSON.stringify(data.results));
  return data.results;
}

/** Register a share event (API TOS requirement) */
export async function registerShare(id: string, searchTerm?: string): Promise<void> {
  try {
    const params: Record<string, string> = { id };
    if (searchTerm) params.q = searchTerm;
    const url = buildUrl("registershare", params);
    await fetch(url);
  } catch {
    // Best-effort, don't fail the request
  }
}
