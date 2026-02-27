import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUserSearch } from "./useUserSearch";
import { UserSearchResultItem } from "./UserSearchResultItem";

export function UserSearchInput() {
  const { query, setQuery, results, isSearching } = useUserSearch();
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const showDropdown = focused && query.trim() && (results.length > 0 || isSearching);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/[0.06] px-3 py-1.5 transition-all focus-within:ring-pulse/30 focus-within:shadow-[0_0_12px_rgba(139,92,246,0.1)]">
        <Search size={14} className="text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search users..."
          className="w-40 bg-transparent text-sm text-heading placeholder-muted outline-none"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-muted hover:text-heading"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl card-glass shadow-lg">
          {isSearching && (
            <p className="px-3 py-2 text-xs text-muted">Searching...</p>
          )}
          {results.map((r) => (
            <UserSearchResultItem
              key={r.pubkey}
              pubkey={r.pubkey}
              profile={r.profile}
              onClick={(pk) => {
                navigate(`/profile/${pk}`);
                setFocused(false);
                setQuery("");
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
