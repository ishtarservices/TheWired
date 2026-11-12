import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
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
 * Discover shell. Browse leads: the scopes come first and the shared search
 * field sits at the end of the same line. One query is shared across scopes:
 * search once, pivot scope. The last segment is remembered (localStorage) and
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
      {/* One line: the page, its three scopes, and the search they share.
          Scopes read before search, the same order as Explore's header. */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border-light px-8 pb-5 pt-7">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-heading">Discover</h1>
        <ChipRow
          options={SEGMENTS}
          value={segment}
          onSelect={select}
          label="Discover segment"
          variant="text"
        />

        <label className="ml-auto flex h-8 w-72 max-w-full items-center gap-2 rounded-lg border border-border px-2.5 transition-colors focus-within:border-muted">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={PLACEHOLDERS[segment]}
            aria-label={PLACEHOLDERS[segment]}
            className="w-full bg-transparent text-[13px] text-heading outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="rounded-sm text-muted hover:text-heading"
            >
              <X size={13} />
            </button>
          )}
        </label>
      </header>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-7">
        {segment === "spaces" && <SpacesSegment query={query} scrollRef={scrollRef} />}
        {segment === "music" && <MusicSegment query={query} />}
        {segment === "people" && <PeopleSegment query={query} />}
      </div>
    </div>
  );
}
