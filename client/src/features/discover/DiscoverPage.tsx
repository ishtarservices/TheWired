import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Compass, Search, X } from "lucide-react";
import { useAppDispatch } from "@/store/hooks";
import { clearDiscoverPreview } from "@/store/slices/uiSlice";
import { ChipRow } from "./components/ChipRow";
import {
  PLACEHOLDERS,
  SEGMENTS,
  parseSegment,
  resolveInitialSegment,
  storeSegment,
  type DiscoverSegment,
} from "./discoverSegment";
import { SpacesSegment } from "./SpacesSegment";
import { MusicSegment } from "./MusicSegment";
import { PeopleSegment } from "./PeopleSegment";

/**
 * Discover shell. Browse leads: the segment chips come first and the shared
 * search field sits under them. One query is shared across segments — search
 * once, pivot scope. The last segment is remembered (localStorage) and
 * `?segment=music` lets other surfaces deep-link into a scope.
 */
export function DiscoverPage() {
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeSegment = parseSegment(searchParams.get("segment"));
  const [segment, setSegment] = useState<DiscoverSegment>(() =>
    resolveInitialSegment(routeSegment),
  );
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // A deep link wins over storage and becomes the remembered segment.
  useEffect(() => {
    if (routeSegment && routeSegment !== segment) {
      storeSegment(routeSegment);
      setSegment(routeSegment);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSegment]);

  const select = useCallback(
    (next: DiscoverSegment) => {
      storeSegment(next);
      setSegment(next);
      setSearchParams({ segment: next }, { replace: true });
    },
    [setSearchParams],
  );

  // Each segment is a different page of content; don't inherit the previous
  // one's scroll offset.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [segment]);

  // The preview snapshot is a directory row; don't let a stale one (or the
  // space just joined) greet the user on their next visit.
  useEffect(
    () => () => {
      dispatch(clearDiscoverPreview());
    },
    [dispatch],
  );

  return (
    <div data-tour="discover-page" className="flex flex-1 flex-col overflow-hidden">
      {/* Header: identity on the left, the scope switch on the right, then one
          search line under both. Browse (the tabs) reads before search. */}
      <div className="border-b border-border px-6 pt-5 pb-4">
        <div className="mx-auto w-full max-w-5xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                <Compass size={20} className="text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-bold leading-tight text-heading">Discover</h1>
                <p className="text-xs text-muted">Find spaces, music, and people</p>
              </div>
            </div>
            <ChipRow
              options={SEGMENTS}
              value={segment}
              onSelect={select}
              label="Discover segment"
              variant="segmented"
            />
          </div>

          <div className="mt-3 flex max-w-2xl items-center gap-2 rounded-xl bg-field px-3 py-2 ring-1 ring-border transition-all focus-within:ring-primary/30">
            <Search size={14} className="shrink-0 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={PLACEHOLDERS[segment]}
              aria-label={PLACEHOLDERS[segment]}
              className="w-full bg-transparent text-sm text-heading outline-none placeholder-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="text-muted hover:text-heading"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto w-full max-w-5xl">
          {segment === "spaces" && <SpacesSegment query={query} scrollRef={scrollRef} />}
          {segment === "music" && <MusicSegment query={query} />}
          {segment === "people" && <PeopleSegment query={query} />}
        </div>
      </div>
    </div>
  );
}
