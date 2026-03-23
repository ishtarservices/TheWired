import { useState, useCallback, useRef } from "react";
import { getTrendingGifs, searchGifs } from "@/lib/api/gif";
import type { GifItem } from "@/types/emoji";

interface UseGifSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  results: GifItem[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reset: () => void;
}

export function useGifSearch(): UseGifSearchReturn {
  const [query, setQueryState] = useState("");
  const [results, setResults] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextPos, setNextPos] = useState<string>("");
  const [hasMore, setHasMore] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchGifs = useCallback(async (q: string, pos?: string) => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const data = q.trim()
        ? await searchGifs(q.trim(), 20, pos)
        : await getTrendingGifs(20, pos);

      if (controller.signal.aborted) return;

      if (pos) {
        // Appending
        setResults((prev) => [...prev, ...data.results]);
      } else {
        // Fresh search
        setResults(data.results);
      }
      setNextPos(data.next);
      setHasMore(data.results.length > 0 && !!data.next);
    } catch {
      if (!controller.signal.aborted) {
        setHasMore(false);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setNextPos("");
    setHasMore(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchGifs(q);
    }, 300);
  }, [fetchGifs]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || !nextPos) return;
    fetchGifs(query, nextPos);
  }, [loading, hasMore, nextPos, query, fetchGifs]);

  const reset = useCallback(() => {
    setQueryState("");
    setResults([]);
    setNextPos("");
    setHasMore(true);
    setLoading(false);
    abortRef.current?.abort();
  }, []);

  return { query, setQuery, results, loading, hasMore, loadMore, reset };
}
