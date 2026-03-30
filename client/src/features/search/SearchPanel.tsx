import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import {
  Search,
  X,
  User,
  Hash,
  Link2,
  AtSign,
  Calendar,
  Clock,
  Trash2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Avatar } from "@/components/ui/Avatar";
import { Spinner } from "@/components/ui/Spinner";
import { useProfile } from "@/features/profile/useProfile";
import {
  useMessageSearch,
  parseSearchQuery,
  type SearchMode,
  type MessageSearchResult,
} from "./useMessageSearch";
import type { SpaceChannel } from "@/types/space";

// ── Props ──

interface SearchPanelProps {
  mode: SearchMode;
  spaceId?: string | null;
  channels?: SpaceChannel[];
  /** DM: null = search all conversations, string = specific conversation */
  partnerPubkey?: string | null;
  onClose: () => void;
  onJumpToMessage?: (result: MessageSearchResult) => void;
}

// ── Helpers ──

function getSnippet(content: string, query: string, maxLen = 120): string {
  if (!query || content.length <= maxLen) return content.slice(0, maxLen);
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return content.slice(0, maxLen) + "…";
  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + query.length + 80);
  let snippet = content.slice(start, end);
  if (start > 0) snippet = "…" + snippet;
  if (end < content.length) snippet += "…";
  return snippet;
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-primary/25 text-heading px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function formatTimestamp(ts: number): string {
  try {
    return formatDistanceToNow(new Date(ts * 1000), { addSuffix: true });
  } catch {
    return "";
  }
}

// ── Sub-components ──

function ResultItem({
  result,
  textQuery,
  mode,
  onClick,
}: {
  result: MessageSearchResult;
  textQuery: string;
  mode: SearchMode;
  onClick: () => void;
}) {
  const { profile } = useProfile(result.authorPubkey);
  const name =
    profile?.display_name || profile?.name || result.authorPubkey.slice(0, 8) + "…";
  const snippet = getSnippet(result.content, textQuery);

  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover"
    >
      <Avatar src={profile?.picture} alt={name} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="font-semibold text-heading truncate">{name}</span>
          {mode === "space" && result.channelLabel && (
            <>
              <span className="text-faint">·</span>
              <span className="text-muted">#{result.channelLabel}</span>
            </>
          )}
          <span className="ml-auto shrink-0 text-faint">
            {formatTimestamp(result.timestamp)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-soft leading-relaxed line-clamp-2">
          {highlightMatch(snippet, textQuery)}
        </p>
      </div>
    </button>
  );
}

interface FilterSuggestionProps {
  icon: ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}

function FilterSuggestion({ icon, label, hint, onClick }: FilterSuggestionProps) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface text-muted">
        {icon}
      </span>
      <div className="min-w-0">
        <span className="text-xs font-medium text-heading">{label}</span>
        <span className="ml-1.5 text-[11px] text-faint">{hint}</span>
      </div>
    </button>
  );
}

// ── Main Component ──

export function SearchPanel({
  mode,
  spaceId,
  channels,
  partnerPubkey,
  onClose,
  onJumpToMessage,
}: SearchPanelProps) {
  const {
    query,
    setQuery,
    results,
    resultCount,
    isSearching,
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
  } = useMessageSearch({ mode, spaceId, channels, partnerPubkey });

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showDropdown, setShowDropdown] = useState(true);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const insertFilter = useCallback(
    (prefix: string) => {
      setQuery((prev) => {
        const trimmed = prev.trimEnd();
        return trimmed ? `${trimmed} ${prefix}:` : `${prefix}:`;
      });
      inputRef.current?.focus();
    },
    [setQuery],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        addToHistory(query.trim());
      }
    },
    [query, addToHistory],
  );

  const handleResultClick = useCallback(
    (result: MessageSearchResult) => {
      addToHistory(query.trim());
      onJumpToMessage?.(result);
    },
    [query, addToHistory, onJumpToMessage],
  );

  const handleHistoryClick = useCallback(
    (q: string) => {
      setQuery(q);
      inputRef.current?.focus();
    },
    [setQuery],
  );

  // Parse active filters for chip display
  const parsed = query.trim() ? parseSearchQuery(query.trim(), channels) : null;
  const activeFilters: { key: string; label: string; raw: string }[] = [];
  if (parsed) {
    if (parsed.fromRaw)
      activeFilters.push({ key: "from", label: "from", raw: parsed.fromRaw });
    if (parsed.channelRaw)
      activeFilters.push({ key: "in", label: "in", raw: parsed.channelRaw });
    if (parsed.has)
      activeFilters.push({ key: "has", label: "has", raw: parsed.has });
    if (parsed.mentionsRaw)
      activeFilters.push({ key: "mentions", label: "mentions", raw: parsed.mentionsRaw });
    if (parsed.before)
      activeFilters.push({ key: "before", label: "before", raw: new Date(parsed.before * 1000).toLocaleDateString() });
    if (parsed.after)
      activeFilters.push({ key: "after", label: "after", raw: new Date(parsed.after * 1000).toLocaleDateString() });
  }

  const removeFilter = useCallback(
    (key: string) => {
      // Remove the filter token from the query
      const regex = new RegExp(`${key}:"[^"]*"|${key}:\\S+`, "gi");
      setQuery((prev) => prev.replace(regex, "").replace(/\s+/g, " ").trim());
    },
    [setQuery],
  );

  const hasQuery = query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative">
      {/* Inline search input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-lg bg-field ring-1 ring-border px-2.5 py-1.5 transition-all focus-within:ring-primary/30 focus-within:shadow-[0_0_12px_var(--focus-glow-color)]">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder={
              mode === "space" ? "Search messages…" : "Search conversation…"
            }
            className="w-44 bg-transparent text-xs text-heading placeholder-muted outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-muted hover:text-heading transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          title="Close search"
        >
          <X size={14} />
        </button>
      </form>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[380px] overflow-hidden rounded-xl border border-border-light bg-panel shadow-xl shadow-black/40">
          {/* Active filter chips */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
              {activeFilters.map((f) => (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  <span className="text-primary/60">{f.label}:</span>
                  {f.raw}
                  <button
                    onClick={() => removeFilter(f.key)}
                    className="ml-0.5 rounded-sm p-0.5 hover:bg-primary/20 transition-colors"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {!hasQuery ? (
            <>
              {/* Filter suggestions */}
              <div className="border-b border-border py-1">
                <div className="px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                    Filters
                  </span>
                </div>
                <FilterSuggestion
                  icon={<User size={13} />}
                  label="From a specific user"
                  hint="from: user or npub"
                  onClick={() => insertFilter("from")}
                />
                {mode === "space" && (
                  <FilterSuggestion
                    icon={<Hash size={13} />}
                    label="In a specific channel"
                    hint="in: channel"
                    onClick={() => insertFilter("in")}
                  />
                )}
                <FilterSuggestion
                  icon={<Link2 size={13} />}
                  label="Contains a type of content"
                  hint="has: link, image, video, file"
                  onClick={() => insertFilter("has")}
                />
                {mode === "space" && (
                  <FilterSuggestion
                    icon={<AtSign size={13} />}
                    label="Mentions a specific user"
                    hint="mentions: user or npub"
                    onClick={() => insertFilter("mentions")}
                  />
                )}
                <FilterSuggestion
                  icon={<Calendar size={13} />}
                  label="Date range"
                  hint="before: / after: date"
                  onClick={() => insertFilter("after")}
                />
              </div>

              {/* Search history */}
              {history.length > 0 && (
                <div className="py-1">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
                      Recent Searches
                    </span>
                    <button
                      onClick={clearHistory}
                      className="rounded p-0.5 text-faint hover:text-muted transition-colors"
                      title="Clear history"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  {history.map((h) => (
                    <div
                      key={h}
                      className="group flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover transition-colors"
                    >
                      <Clock size={12} className="shrink-0 text-faint" />
                      <button
                        onClick={() => handleHistoryClick(h)}
                        className="min-w-0 flex-1 truncate text-left text-xs text-soft hover:text-heading transition-colors"
                      >
                        {h}
                      </button>
                      <button
                        onClick={() => removeFromHistory(h)}
                        className="shrink-0 rounded p-0.5 text-faint opacity-0 group-hover:opacity-100 hover:text-muted transition-all"
                        title="Remove"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {history.length === 0 && (
                <div className="px-3 py-4 text-center">
                  <Search size={20} className="mx-auto mb-1.5 text-muted/30" />
                  <p className="text-xs text-muted">
                    Search {mode === "space" ? "this space" : "messages"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-faint">
                    Use filters to narrow results
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Results header */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                {isSearching ? (
                  <div className="flex items-center gap-2">
                    <Spinner size="sm" />
                    <span className="text-[11px] text-muted">Searching…</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-muted">
                    {resultCount === 0
                      ? "No results"
                      : `${resultCount} result${resultCount !== 1 ? "s" : ""}`}
                    {resultCount > RESULTS_LIMIT_DISPLAY &&
                      ` (showing ${RESULTS_LIMIT_DISPLAY})`}
                  </span>
                )}
              </div>

              {/* Results list */}
              <div className="max-h-[400px] overflow-y-auto overscroll-contain">
                {results.map((result) => (
                  <ResultItem
                    key={result.id + (result.wrapId ?? "")}
                    result={result}
                    textQuery={parsed?.text ?? ""}
                    mode={mode}
                    onClick={() => handleResultClick(result)}
                  />
                ))}

                {!isSearching && results.length === 0 && (
                  <div className="px-3 py-6 text-center">
                    <Search size={20} className="mx-auto mb-1.5 text-muted/20" />
                    <p className="text-xs text-muted">No messages found</p>
                    <p className="mt-0.5 text-[11px] text-faint">
                      Try different keywords or filters
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const RESULTS_LIMIT_DISPLAY = 50;
