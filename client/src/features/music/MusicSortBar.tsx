import { ArrowUpDown, ArrowUp, ArrowDown, Search } from "lucide-react";
import type { SortDir, TrackSortKey } from "@/types/music";
import type { SortOption } from "./sortMusic";

interface SortDropdownProps<K extends string> {
  value: K;
  dir: SortDir;
  options: SortOption<K>[];
  onChangeKey: (key: K) => void;
  onToggleDir: () => void;
}

/**
 * Compact sort control: a native <select> for the sort key plus a direction
 * toggle. Matches the SpaceMusicView idiom (styled select + ArrowUpDown overlay).
 */
export function SortDropdown<K extends string>({
  value,
  dir,
  options,
  onChangeKey,
  onToggleDir,
}: SortDropdownProps<K>) {
  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChangeKey(e.target.value as K)}
          aria-label="Sort by"
          className="appearance-none rounded-full border border-border bg-field pl-7 pr-6 py-1 text-xs text-heading outline-none focus:border-primary/30"
        >
          {options.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <ArrowUpDown
          size={12}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
        />
      </div>
      <button
        type="button"
        onClick={onToggleDir}
        title={dir === "asc" ? "Ascending" : "Descending"}
        aria-label={dir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
        className="rounded-full border border-border p-1.5 text-muted transition-colors hover:text-heading"
      >
        {dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      </button>
    </div>
  );
}

interface FilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Quick filter box (filters by title/artist). Mirrors SpaceMusicView's filter input. */
export function FilterInput({ value, onChange, placeholder = "Filter…" }: FilterInputProps) {
  return (
    <div className="relative flex items-center">
      <Search size={13} className="absolute left-2.5 text-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Filter list"
        className="w-36 rounded-full border border-border bg-field pl-8 pr-3 py-1 text-xs text-heading placeholder-muted outline-none transition-all focus:w-48 focus:border-primary/30"
      />
    </div>
  );
}

interface SortableTrackHeaderProps {
  sortKey: TrackSortKey;
  dir: SortDir;
  onSort: (key: TrackSortKey) => void;
}

function HeaderArrow({ dir }: { dir: SortDir }) {
  return dir === "asc" ? (
    <ArrowUp size={11} className="text-primary" />
  ) : (
    <ArrowDown size={11} className="text-primary" />
  );
}

/**
 * Track-table column header row, shared by SongList / RecentlyAdded / Favorites / MyUploads.
 * Title / Genre / Time are clickable sort shortcuts; the active column shows a direction arrow.
 */
export function SortableTrackHeader({ sortKey, dir, onSort }: SortableTrackHeaderProps) {
  const active = (key: TrackSortKey) =>
    sortKey === key ? "text-primary" : "hover:text-heading";

  return (
    <div className="grid grid-cols-[2rem_1fr_1fr_4rem_2rem] gap-4 border-b border-border px-3 pb-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted">
      <span>#</span>
      <button
        type="button"
        onClick={() => onSort("title")}
        className={`flex items-center gap-1 text-left uppercase tracking-[0.15em] transition-colors ${active("title")}`}
      >
        Title
        {sortKey === "title" && <HeaderArrow dir={dir} />}
      </button>
      <button
        type="button"
        onClick={() => onSort("genre")}
        className={`flex items-center gap-1 text-left uppercase tracking-[0.15em] transition-colors ${active("genre")}`}
      >
        Genre
        {sortKey === "genre" && <HeaderArrow dir={dir} />}
      </button>
      <button
        type="button"
        onClick={() => onSort("duration")}
        className={`flex items-center justify-end gap-1 uppercase tracking-[0.15em] transition-colors ${active("duration")}`}
      >
        Time
        {sortKey === "duration" && <HeaderArrow dir={dir} />}
      </button>
      <span />
    </div>
  );
}
