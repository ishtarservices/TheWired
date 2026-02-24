import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api/client";

interface MusicSearchHit {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
}

interface SearchResults {
  tracks: MusicSearchHit[];
  albums: MusicSearchHit[];
}

export function useMusicSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ tracks: [], albums: [] });
  const [isSearching, setIsSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults({ tracks: [], albums: [] });
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsSearching(true);
      try {
        const [trackRes, albumRes] = await Promise.all([
          api<MusicSearchHit[]>(
            `/search?q=${encodeURIComponent(query)}&kind=31683&limit=5`,
            { signal: controller.signal },
          ),
          api<MusicSearchHit[]>(
            `/search?q=${encodeURIComponent(query)}&kind=33123&limit=5`,
            { signal: controller.signal },
          ),
        ]);
        if (!controller.signal.aborted) {
          setResults({
            tracks: trackRes.data,
            albums: albumRes.data,
          });
        }
      } catch {
        // abort or error
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  return { query, setQuery, results, isSearching };
}
