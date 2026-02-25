import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { nip19 } from "nostr-tools";
import { X } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useUserSearch } from "../search/useUserSearch";
import { UserSearchResultItem } from "../search/UserSearchResultItem";

interface MemberInputProps {
  members: string[];
  onAdd: (pubkey: string) => void;
  onRemove: (pubkey: string) => void;
}

function MemberChip({
  pubkey,
  onRemove,
}: {
  pubkey: string;
  onRemove: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-card-hover py-0.5 pl-0.5 pr-2 text-xs text-heading">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <span className="max-w-[120px] truncate">{name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 hover:bg-edge-light transition-colors"
      >
        <X size={12} />
      </button>
    </div>
  );
}

function parsePubkeyInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      return null;
    }
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return null;
}

export function MemberInput({ members, onAdd, onRemove }: MemberInputProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const { query, setQuery, results, isSearching } = useUserSearch();

  const isDirectPubkey = !!parsePubkeyInput(input.trim());
  const filteredResults = results.filter((r) => !members.includes(r.pubkey));
  const showDropdown = focused && query.trim() && !isDirectPubkey && (filteredResults.length > 0 || isSearching);

  // Sync input to search query
  useEffect(() => {
    setQuery(input);
  }, [input, setQuery]);

  // Position the portal dropdown relative to the input
  useLayoutEffect(() => {
    if (showDropdown && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
  }, [showDropdown, input]);

  // Close on click outside (check both container and portaled dropdown)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        (!dropdownRef.current || !dropdownRef.current.contains(target))
      ) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleSubmit() {
    const pubkey = parsePubkeyInput(input);
    if (!pubkey) {
      setError("Invalid npub or hex pubkey");
      return;
    }
    if (members.includes(pubkey)) {
      setError("Already added");
      return;
    }
    onAdd(pubkey);
    setInput("");
    setError(null);
  }

  function handleSelectResult(pubkey: string) {
    if (members.includes(pubkey)) return;
    onAdd(pubkey);
    setInput("");
    setFocused(false);
    setError(null);
  }

  return (
    <div ref={containerRef}>
      <div className="flex flex-col gap-1.5">
        <div>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setError(null);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder="Search by name, npub, or hex..."
            className="w-full rounded-md border border-edge-light bg-field px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
          />

          {showDropdown && dropdownPos && createPortal(
            <div
              ref={dropdownRef}
              className="fixed z-[9999] rounded-lg border border-edge bg-panel shadow-lg"
              style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            >
              {isSearching && (
                <p className="px-3 py-2 text-xs text-muted">Searching...</p>
              )}
              {filteredResults.map((r) => (
                <UserSearchResultItem
                  key={r.pubkey}
                  pubkey={r.pubkey}
                  profile={r.profile}
                  onClick={handleSelectResult}
                />
              ))}
            </div>,
            document.body,
          )}
        </div>
        <button
          onClick={handleSubmit}
          className="w-full rounded-md bg-pulse px-3 py-1.5 text-sm font-medium text-white hover:bg-pulse-soft hover-lift transition-all duration-150"
        >
          Add
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {members.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {members.map((pk) => (
            <MemberChip key={pk} pubkey={pk} onRemove={() => onRemove(pk)} />
          ))}
        </div>
      )}
    </div>
  );
}
