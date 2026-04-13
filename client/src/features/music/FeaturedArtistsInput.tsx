import { useState, useRef, useEffect } from "react";
import { X, Search } from "lucide-react";
import { nip19 } from "nostr-tools";
import { useProfile } from "@/features/profile/useProfile";
import { useUserSearch } from "@/features/search/useUserSearch";
import { Avatar } from "@/components/ui/Avatar";

/** Inline display of a featured artist pubkey (resolves name via profile) */
function ArtistChip({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const { profile } = useProfile(pubkey);
  const label = profile?.display_name || profile?.name || pubkey.slice(0, 12) + "...";

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-card px-2 py-0.5 text-xs text-heading">
      <Avatar src={profile?.picture} size="xs" />
      <span className="max-w-[120px] truncate">{label}</span>
      <button onClick={onRemove} className="text-muted hover:text-heading">
        <X size={12} />
      </button>
    </span>
  );
}

function parsePubkeyInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      return null;
    }
  }
  return null;
}

interface FeaturedArtistsInputProps {
  value: string[];
  onChange: (pubkeys: string[]) => void;
  label?: string;
  placeholder?: string;
}

export function FeaturedArtistsInput({
  value,
  onChange,
  label = "Featured Artists",
  placeholder = "Search by name, npub, or hex pubkey...",
}: FeaturedArtistsInputProps) {
  const { query, setQuery, results, isSearching } = useUserSearch();
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const addPubkey = (pubkey: string) => {
    if (value.includes(pubkey)) {
      setError("Already added");
      return;
    }
    onChange([...value, pubkey]);
    setQuery("");
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Try direct pubkey parse first
      const pubkey = parsePubkeyInput(query);
      if (pubkey) {
        addPubkey(pubkey);
        return;
      }
      // If there's exactly one result, select it
      const available = results.filter((r) => !value.includes(r.pubkey));
      if (available.length === 1) {
        addPubkey(available[0].pubkey);
        return;
      }
      if (query.trim() && !isSearching) {
        setError("No matching user found");
      }
    }
  };

  // Filter out already-selected pubkeys from results
  const filteredResults = results.filter((r) => !value.includes(r.pubkey));
  const showDropdown = focused && query.trim().length > 0 && (filteredResults.length > 0 || isSearching);

  return (
    <div ref={containerRef}>
      <label className="mb-1 block text-xs font-medium text-soft">
        {label}
      </label>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((pk) => (
            <ArtistChip
              key={pk}
              pubkey={pk}
              onRemove={() => onChange(value.filter((p) => p !== pk))}
            />
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-field px-3 py-1.5 focus-within:border-primary/30 transition-colors">
          <Search size={14} className="text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            className="flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
            placeholder={placeholder}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(""); setError(null); }}
              className="text-muted hover:text-heading"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {showDropdown && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-border-light bg-panel shadow-xl shadow-black/40">
            {isSearching && filteredResults.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted">Searching...</p>
            )}
            {filteredResults.map((r) => {
              const name = r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8) + "...";
              const secondary = r.profile.nip05 || r.pubkey.slice(0, 12) + "...";
              return (
                <button
                  key={r.pubkey}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => addPubkey(r.pubkey)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-card-hover/30"
                >
                  <Avatar src={r.profile.picture} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-heading">{name}</p>
                    <p className="truncate text-xs text-muted">{secondary}</p>
                  </div>
                </button>
              );
            })}
            {isSearching && filteredResults.length > 0 && (
              <p className="px-3 py-1.5 text-center text-[10px] text-muted">Searching for more...</p>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
