import { useState } from "react";
import { X, Search, Send } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useAppSelector } from "@/store/hooks";
import { useUserSearch } from "@/features/search/useUserSearch";
import { useProfile } from "@/features/profile/useProfile";

interface RecipientPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (pubkey: string) => void;
  title?: string;
}

function ContactRow({
  pubkey,
  onSelect,
}: {
  pubkey: string;
  onSelect: (pubkey: string) => void;
}) {
  const { profile } = useProfile(pubkey);
  const name =
    profile?.display_name || profile?.name || pubkey.slice(0, 12) + "...";

  return (
    <button
      onClick={() => onSelect(pubkey)}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface"
    >
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm text-heading">{name}</p>
        <p className="truncate text-xs text-muted">{pubkey.slice(0, 16)}...</p>
      </div>
      <Send size={14} className="shrink-0 text-muted" />
    </button>
  );
}

export function RecipientPickerModal({
  open,
  onClose,
  onSelect,
  title = "Send to DM",
}: RecipientPickerModalProps) {
  const dmContacts = useAppSelector((s) => s.dm.contacts);
  const friends = useAppSelector((s) =>
    s.friendRequests.requests
      .filter((r) => r.status === "accepted")
      .map((r) => r.pubkey),
  );
  const { query, setQuery, results, isSearching } = useUserSearch();
  const [sending, setSending] = useState(false);

  const handleSelect = async (pubkey: string) => {
    if (sending) return;
    setSending(true);
    try {
      await onSelect(pubkey);
      onClose();
    } catch {
      // Let caller handle errors
    } finally {
      setSending(false);
    }
  };

  // Merge DM contacts and friends, deduped
  const contactPubkeys = new Set<string>();
  const contactList: string[] = [];
  for (const c of dmContacts) {
    if (!contactPubkeys.has(c.pubkey)) {
      contactPubkeys.add(c.pubkey);
      contactList.push(c.pubkey);
    }
  }
  for (const pk of friends) {
    if (!contactPubkeys.has(pk)) {
      contactPubkeys.add(pk);
      contactList.push(pk);
    }
  }

  const showSearchResults = query.trim().length > 0;

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-edge card-glass p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-heading">{title}</h2>
          <button onClick={onClose} className="text-soft hover:text-heading">
            <X size={18} />
          </button>
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or npub..."
            className="w-full rounded-xl border border-edge bg-field pl-9 pr-3 py-2 text-sm text-heading placeholder-muted outline-none focus:border-pulse/30"
            autoFocus
          />
        </div>

        {sending && (
          <div className="mb-2 flex items-center gap-2 text-xs text-soft">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
            Sending...
          </div>
        )}

        <div className="max-h-72 overflow-y-auto">
          {showSearchResults ? (
            <>
              {results.length === 0 && !isSearching && (
                <p className="py-4 text-center text-sm text-soft">
                  No users found
                </p>
              )}
              {isSearching && results.length === 0 && (
                <p className="py-4 text-center text-sm text-soft">
                  Searching...
                </p>
              )}
              {results.map((r) => (
                <ContactRow
                  key={r.pubkey}
                  pubkey={r.pubkey}
                  onSelect={handleSelect}
                />
              ))}
            </>
          ) : (
            <>
              {contactList.length === 0 ? (
                <p className="py-4 text-center text-sm text-soft">
                  No contacts yet. Search for a user above.
                </p>
              ) : (
                <>
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    Recent
                  </p>
                  {contactList.map((pk) => (
                    <ContactRow
                      key={pk}
                      pubkey={pk}
                      onSelect={handleSelect}
                    />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
