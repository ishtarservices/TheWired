import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { GENRE_TAXONOMY } from "./genreTaxonomy";

interface GenrePickerProps {
  value: string;
  onChange: (genre: string) => void;
  label?: string;
  placeholder?: string;
}

export function GenrePicker({
  value,
  onChange,
  label = "Genre",
  placeholder = "Select or type a genre",
}: GenrePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search
    ? GENRE_TAXONOMY.filter((g) =>
        g.toLowerCase().includes(search.toLowerCase()),
      )
    : GENRE_TAXONOMY;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (genre: string) => {
    onChange(genre);
    setSearch("");
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setSearch(v);
    onChange(v);
    if (!open) setOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label className="mb-1 block text-xs font-medium text-soft">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? search || value : value}
          onChange={handleInputChange}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full rounded-xl border border-edge bg-field px-3 py-1.5 pr-8 text-sm text-heading outline-none focus:border-pulse/30"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            if (!open) inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-heading"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-edge bg-card shadow-lg">
          {filtered.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => handleSelect(genre)}
              className={`w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover ${
                genre === value ? "text-heading" : "text-soft"
              }`}
            >
              {genre}
            </button>
          ))}
          {search && !GENRE_TAXONOMY.some((g) => g.toLowerCase() === search.toLowerCase()) && (
            <button
              type="button"
              onClick={() => handleSelect(search)}
              className="w-full border-t border-edge px-3 py-1.5 text-left text-sm text-soft hover:bg-surface-hover"
            >
              Use "{search}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
