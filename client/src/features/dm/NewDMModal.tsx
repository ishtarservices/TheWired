import { useMemo, memo, useRef, useEffect } from "react";
import { Search, X, MessageCircle, Users, Clock } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useUserSearch } from "@/features/search/useUserSearch";
import { useProfile } from "@/features/profile/useProfile";
import { useDMContacts } from "./useDMContacts";
import { useFriends } from "./useFriends";
import { useAppSelector } from "@/store/hooks";
import { getDisplayName } from "./dmUtils";
import type { Kind0Profile } from "@/types/profile";

interface NewDMModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (pubkey: string) => void;
}

export function NewDMModal({ open, onClose, onSelect }: NewDMModalProps) {
  const { query, setQuery, results, isSearching } = useUserSearch();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const contacts = useDMContacts();
  const friends = useFriends();
  const spaces = useAppSelector((s) => s.spaces.list);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery("");
      // Small delay for portal mount
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open, setQuery]);

  // Collect unique space member pubkeys the user might know
  const spacePeople = useMemo(() => {
    const contactSet = new Set(contacts.map((c) => c.pubkey));
    const friendSet = new Set(friends);
    const seen = new Set<string>();
    const people: string[] = [];

    for (const space of spaces) {
      for (const pk of space.memberPubkeys) {
        if (pk === myPubkey) continue;
        if (contactSet.has(pk)) continue;
        if (friendSet.has(pk)) continue;
        if (seen.has(pk)) continue;
        seen.add(pk);
        people.push(pk);
      }
    }
    return people.slice(0, 20);
  }, [spaces, myPubkey, contacts, friends]);

  const trimmed = query.trim();
  const isSearchActive = trimmed.length > 0;

  // Filter search results to exclude self
  const filteredResults = useMemo(
    () => results.filter((r) => r.pubkey !== myPubkey),
    [results, myPubkey],
  );

  const handleSelect = (pubkey: string) => {
    onSelect(pubkey);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl card-glass border border-edge shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-4 py-3">
          <h2 className="text-sm font-semibold text-heading">New Message</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search input */}
        <div className="px-4 py-3 border-b border-edge">
          <div className="flex items-center gap-2 rounded-xl bg-field border border-edge px-3 py-2 focus-within:border-pulse/40 transition-colors">
            <Search size={14} className="text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, npub, or hex pubkey..."
              className="flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-muted hover:text-heading transition-colors"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Results / Browse area */}
        <div className="max-h-80 overflow-y-auto">
          {isSearchActive ? (
            /* ── Search results ── */
            <>
              {isSearching && filteredResults.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted">
                  Searching...
                </div>
              )}
              {!isSearching && filteredResults.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted">
                  No users found
                </div>
              )}
              {filteredResults.map((r) => (
                <SearchResultItem
                  key={r.pubkey}
                  pubkey={r.pubkey}
                  profile={r.profile}
                  onClick={() => handleSelect(r.pubkey)}
                />
              ))}
              {isSearching && filteredResults.length > 0 && (
                <div className="px-4 py-2 text-center text-[11px] text-faint">
                  Searching for more...
                </div>
              )}
            </>
          ) : (
            /* ── Browse: Friends → Recent → Space members ── */
            <>
              {/* Friends */}
              {friends.length > 0 && (
                <Section icon={Users} label="Friends">
                  {friends.map((pk) => (
                    <PersonItem
                      key={pk}
                      pubkey={pk}
                      onClick={() => handleSelect(pk)}
                    />
                  ))}
                </Section>
              )}

              {/* Recent conversations */}
              {contacts.length > 0 && (
                <Section icon={Clock} label="Recent">
                  {contacts
                    .filter((c) => c.pubkey !== myPubkey)
                    .slice(0, 10)
                    .map((c) => (
                      <PersonItem
                        key={c.pubkey}
                        pubkey={c.pubkey}
                        subtitle={c.lastMessagePreview}
                        onClick={() => handleSelect(c.pubkey)}
                      />
                    ))}
                </Section>
              )}

              {/* People from spaces */}
              {spacePeople.length > 0 && (
                <Section icon={MessageCircle} label="From your spaces">
                  {spacePeople.map((pk) => (
                    <PersonItem
                      key={pk}
                      pubkey={pk}
                      onClick={() => handleSelect(pk)}
                    />
                  ))}
                </Section>
              )}

              {/* Empty state if nothing to show */}
              {friends.length === 0 &&
                contacts.length === 0 &&
                spacePeople.length === 0 && (
                  <div className="px-4 py-8 text-center">
                    <Search
                      size={24}
                      className="mx-auto mb-2 text-muted opacity-30"
                    />
                    <p className="text-xs text-muted">
                      Search for someone by name or paste an npub
                    </p>
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ── Section wrapper ── */
function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Users;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-4 pt-2 pb-1">
        <Icon size={11} className="text-muted" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

/* ── Search result item (has profile already) ── */
const SearchResultItem = memo(function SearchResultItem({
  pubkey,
  profile,
  onClick,
}: {
  pubkey: string;
  profile: Kind0Profile;
  onClick: () => void;
}) {
  const name =
    profile.display_name || profile.name || pubkey.slice(0, 8) + "...";

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
    >
      <Avatar src={profile.picture} alt={name} size="sm" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-heading truncate block">
          {name}
        </span>
        {profile.nip05 && (
          <span className="text-[11px] text-muted truncate block">
            {profile.nip05}
          </span>
        )}
      </div>
      <MessageCircle size={14} className="shrink-0 text-muted" />
    </button>
  );
});

/* ── Person item (fetches profile by pubkey) ── */
const PersonItem = memo(function PersonItem({
  pubkey,
  subtitle,
  onClick,
}: {
  pubkey: string;
  subtitle?: string;
  onClick: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const displayName = getDisplayName(profile, pubkey);

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-hover"
    >
      <Avatar src={profile?.picture} alt={displayName} size="sm" />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-heading truncate block">
          {displayName}
        </span>
        {subtitle ? (
          <span className="text-[11px] text-muted truncate block">
            {subtitle}
          </span>
        ) : (
          profile?.nip05 && (
            <span className="text-[11px] text-muted truncate block">
              {profile.nip05}
            </span>
          )
        )}
      </div>
      <MessageCircle size={14} className="shrink-0 text-muted" />
    </button>
  );
});
