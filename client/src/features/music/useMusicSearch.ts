import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api/client";

export interface MusicSearchHit {
  id: string;
  addressable_id: string;
  title: string;
  artist: string;
  genre: string;
  image_url: string;
  hashtags: string[];
  pubkey: string;
  created_at: number;
}

interface SearchResults {
  tracks: MusicSearchHit[];
  albums: MusicSearchHit[];
}

const EMPTY: SearchResults = { tracks: [], albums: [] };

// Module-level LRU cache — survives re-renders and remounts.
// Max 30 entries (~60 KB). Keyed by "query|genre".
const cache = new Map<string, { results: SearchResults; ts: number }>();
const CACHE_MAX = 30;
const CACHE_TTL = 60_000; // 1 minute

function getCached(key: string): SearchResults | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  // Move to end (LRU refresh)
  cache.delete(key);
  cache.set(key, entry);
  return entry.results;
}

function setCache(key: string, results: SearchResults) {
  // Evict oldest if full
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { results, ts: Date.now() });
}

export function useMusicSearch(opts?: { genre?: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const genre = opts?.genre;

  useEffect(() => {
    if (!query.trim()) {
      setResults(EMPTY);
      setIsSearching(false);
      return;
    }

    const cacheKey = `${query.trim().toLowerCase()}|${genre ?? ""}`;
    const cached = getCached(cacheKey);
    if (cached) {
      setResults(cached);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const genreParam = genre ? `&genre=${encodeURIComponent(genre)}` : "";

      setIsSearching(true);
      try {
        // Use the dedicated /search/music endpoint which queries the tracks/albums
        // Meilisearch indexes (searchable: title, artist, genre, hashtags).
        // auth: false — search is public, and the gateway strips query params from
        // the URL comparison which would cause NIP-98 validation to fail.
        const [trackRes, albumRes] = await Promise.all([
          api<MusicSearchHit[]>(
            `/search/music?q=${encodeURIComponent(query)}&type=track&limit=8${genreParam}`,
            { signal: controller.signal, auth: false },
          ),
          api<MusicSearchHit[]>(
            `/search/music?q=${encodeURIComponent(query)}&type=album&limit=4${genreParam}`,
            { signal: controller.signal, auth: false },
          ),
        ]);
        if (!controller.signal.aborted) {
          const fresh = { tracks: trackRes.data, albums: albumRes.data };
          setCache(cacheKey, fresh);
          setResults(fresh);
        }
      } catch {
        // abort or error
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query, genre]);

  return { query, setQuery, results, isSearching };
}
