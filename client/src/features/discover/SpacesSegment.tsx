import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Compass } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { previewDiscoverSpace } from "@/store/slices/uiSlice";
import { RevealSentinel } from "@/components/ui/RevealSentinel";
import { Spinner } from "@/components/ui/Spinner";
import { discoverSpaces, type DiscoverSpace } from "@/lib/api/discover";
import { ChipRow, type ChipOption } from "./components/ChipRow";
import { CategoryGrid } from "./components/CategoryGrid";
import { SectionHeader } from "./components/SectionHeader";
import { RowSkeleton, TileGridSkeleton } from "./components/Skeletons";
import { SpaceRow } from "./components/SpaceRow";
import { categoryTiles, visibleCategories } from "./categoryTiles";
import {
  SPACE_SORT_FOR_MODE,
  rankSpaces,
  spaceSignalLabel,
  type SpaceRankMode,
} from "./ranking";
import { matchesScene, sceneBySlug, sceneChips } from "./taxonomy";
import { useCategories } from "./useCategories";
import { useScenes } from "./useScenes";

const PAGE_SIZE = 25;
const DEBOUNCE_MS = 300;

const SORT_CHIPS: ChipOption<SpaceRankMode>[] = [
  { value: "zapped", label: "Zapped" },
  { value: "active", label: "Active" },
  { value: "new", label: "New" },
  { value: "big", label: "Biggest" },
];

/**
 * The public spaces directory. Browse (scenes, category tiles) leads; the
 * ranked list under it explains every row with a why-line. The backend does
 * the real ordering; `rankSpaces` only stabilises it so a refetch never
 * reshuffles rows.
 */
export function SpacesSegment({
  query,
  scrollRef,
}: {
  query: string;
  scrollRef?: RefObject<HTMLDivElement | null>;
}) {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) => s.ui.discoverPreviewSpace?.id ?? null);
  const scenes = useScenes();
  const { categories } = useCategories();

  const [directory, setDirectory] = useState<DiscoverSpace[] | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [sort, setSort] = useState<SpaceRankMode>("zapped");
  const [scene, setScene] = useState("all");
  const [category, setCategory] = useState("all");
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [paging, setPaging] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const filtering = debouncedSearch.length > 0 || category !== "all" || scene !== "all";

  // Scene chips need to know what tags actually exist before they can offer a
  // scene — a chip leading to an empty list reads as a broken app. The first
  // unfiltered page is the sample we judge from.
  const [corpusTags, setCorpusTags] = useState<string[]>([]);

  const activeScene = scene === "all" ? null : (sceneBySlug(scenes, scene) ?? null);
  // The backend takes a comma-separated OR list, so a scene filters
  // server-side in one request. `activeScene.tags` is referentially stable
  // (useScenes caches its array) — that is what keeps loadDirectory's deps
  // from looping.
  const sceneTags = activeScene ? activeScene.tags : null;

  // Last-write-wins guard: rapid sort/scene/search toggles can resolve out of
  // order and paint stale results over fresh ones. Only the newest in-flight
  // request may touch state (success AND error paths) — and paging shares the
  // counter so an append can never land after a filter change reset the list.
  const directorySeqRef = useRef(0);

  // A filter change reshapes the header (tile grid comes and goes), so start
  // the reader at the top, where the browse row that undoes the filter lives.
  useEffect(() => {
    scrollRef?.current?.scrollTo({ top: 0 });
  }, [category, sceneTags, debouncedSearch, scrollRef]);

  const loadDirectory = useCallback(() => {
    const seq = ++directorySeqRef.current;
    setDirectoryError(null);
    setExhausted(false);
    return discoverSpaces({
      sort: SPACE_SORT_FOR_MODE[sort],
      category: category === "all" ? undefined : category,
      tag: sceneTags ?? undefined,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE,
    })
      .then(({ data: spaces }) => {
        if (seq !== directorySeqRef.current) return;
        setDirectory(spaces);
        setExhausted(spaces.length < PAGE_SIZE);
        // Only an unfiltered page is a fair sample of the whole corpus.
        if (!filtering) {
          setCorpusTags((prev) =>
            prev.length > 0 ? prev : Array.from(new Set(spaces.flatMap((s) => s.tags))),
          );
        }
      })
      .catch((e: unknown) => {
        if (seq !== directorySeqRef.current) return;
        setDirectory([]);
        setDirectoryError(e instanceof Error ? e.message : "Couldn't load the directory.");
      });
    // `filtering` is derived from the same inputs already in this list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, category, sceneTags, debouncedSearch]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const loadMore = useCallback(() => {
    if (paging || exhausted || directory === null || directory.length === 0) return;
    const seq = directorySeqRef.current;
    setPaging(true);
    discoverSpaces({
      sort: SPACE_SORT_FOR_MODE[sort],
      category: category === "all" ? undefined : category,
      tag: sceneTags ?? undefined,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset: directory.length,
    })
      .then(({ data: page }) => {
        // A filter changed while this page was in flight — discard it rather
        // than appending yesterday's results to today's list.
        if (seq !== directorySeqRef.current) return;
        setDirectory((prev) => {
          if (prev === null) return page;
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...page.filter((s) => !seen.has(s.id))];
        });
        setExhausted(page.length < PAGE_SIZE);
      })
      .catch(() => {
        if (seq !== directorySeqRef.current) return;
        setExhausted(true); // stop hammering a failing endpoint on every scroll
      })
      .finally(() => setPaging(false));
  }, [paging, exhausted, directory, sort, category, sceneTags, debouncedSearch]);

  // The server already applied the scene's full tag OR-list; this second pass
  // only matters when a row slips through with tags that don't actually match
  // (stale index), so it is a guard rather than the filter.
  const visible = useMemo(() => {
    const base = directory ?? [];
    const scoped = activeScene ? base.filter((s) => matchesScene(activeScene, { tags: s.tags })) : base;
    return rankSpaces(scoped, sort);
  }, [directory, activeScene, sort]);

  const sceneOptions = useMemo<ChipOption[]>(
    () => [{ value: "all", label: "All" }, ...sceneChips(scenes, { tags: corpusTags })],
    [scenes, corpusTags],
  );

  // Category is one filter dimension shared with scene: picking either clears
  // the other, so the header only ever needs one browse row at a time.
  const selectCategory = useCallback((slug: string) => {
    setCategory(slug);
    setScene("all");
  }, []);
  const selectScene = useCallback((slug: string) => {
    setScene(slug);
    setCategory("all");
  }, []);

  const { tiles, hasMore } = useMemo(
    () => categoryTiles(categories ?? [], categoriesExpanded),
    [categories, categoriesExpanded],
  );

  const categoryChips = useMemo<ChipOption[]>(
    () => [
      { value: "all", label: "All" },
      ...visibleCategories(categories ?? []).map((c) => ({ value: c.slug, label: c.name })),
    ],
    [categories],
  );

  const onSelectSpace = useCallback(
    (space: DiscoverSpace) => {
      dispatch(previewDiscoverSpace(space));
    },
    [dispatch],
  );

  const categoryActive = category !== "all";
  const listEmpty = directory !== null && visible.length === 0;

  // Scene and category are one filter dimension, so they share one browse
  // row: category chips while a category is active (so it can be switched or
  // cleared), scenes otherwise. Only offered when something is behind them.
  const browseChips = categoryActive ? (
    <ChipRow options={categoryChips} value={category} onSelect={selectCategory} label="Categories" />
  ) : sceneOptions.length > 1 ? (
    <ChipRow options={sceneOptions} value={scene} onSelect={selectScene} label="Scenes" />
  ) : null;
  const showGrid = !filtering && (categories === null || tiles.length > 0);
  const showBrowse = browseChips !== null || showGrid;

  return (
    <div className="space-y-6">
      {showBrowse && (
        <section className="@container">
          <SectionHeader title="Browse" right={browseChips} />
          {showGrid && categories === null && <TileGridSkeleton />}
          {showGrid && categories !== null && <CategoryGrid tiles={tiles} onSelect={selectCategory} />}
          {showGrid && hasMore && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setCategoriesExpanded((v) => !v)}
                className="text-xs text-muted transition-colors hover:text-primary"
              >
                {categoriesExpanded ? "Fewer categories" : "All categories"}
              </button>
            </div>
          )}
        </section>
      )}

      {/* The ranked list */}
      <section className="@container">
        <SectionHeader
          title={filtering ? "Results" : "All spaces"}
          right={<ChipRow options={SORT_CHIPS} value={sort} onSelect={setSort} label="Sort" variant="segmented" size="sm" />}
        />

        {directory === null ? (
          <RowSkeleton />
        ) : directoryError ? (
          <EmptyState
            title="Directory unavailable"
            message={directoryError}
            action={{ label: "Try again", onClick: () => void loadDirectory() }}
          />
        ) : listEmpty ? (
          filtering ? (
            <EmptyState title="Nothing here yet" message="Try another scene, or a different search." />
          ) : (
            <EmptyState title="No listed spaces" message="Public spaces appear here once listed." />
          )
        ) : (
          <>
            <div className="grid grid-cols-1 gap-2.5 @3xl:grid-cols-2">
              {visible.map((space) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  signal={spaceSignalLabel(space)}
                  selected={space.id === selectedId}
                  onSelect={onSelectSpace}
                />
              ))}
            </div>
            {!exhausted && <RevealSentinel onReach={loadMore} />}
            {paging && (
              <div className="flex justify-center py-4">
                <Spinner size="sm" />
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Compass size={24} className="mb-2 text-muted opacity-30" />
      <p className="text-xs font-medium text-heading">{title}</p>
      <p className="mt-1 text-xs text-faint">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs text-soft transition-colors hover:border-primary/40 hover:text-primary"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
