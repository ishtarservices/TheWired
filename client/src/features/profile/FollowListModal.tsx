import { useState, useMemo } from "react";
import { X, Search, Users } from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { FollowCard } from "./FollowCard";
import { Spinner } from "../../components/ui/Spinner";
import { profileCache } from "../../lib/nostr/profileCache";

const PAGE_SIZE = 50;

interface FollowListModalProps {
  pubkeys: string[];
  loading: boolean;
  mode: "following" | "followers";
  onClose: () => void;
}

export function FollowListModal({ pubkeys, loading, mode, onClose }: FollowListModalProps) {
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    if (!search.trim()) return pubkeys;
    const q = search.toLowerCase();
    return pubkeys.filter((pk) => {
      if (pk.toLowerCase().includes(q)) return true;
      const profile = profileCache.getCached(pk);
      if (!profile) return false;
      const name = (profile.display_name || profile.name || "").toLowerCase();
      return name.includes(q);
    });
  }, [pubkeys, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;
  const title = mode === "following" ? "Following" : "Followers";

  return (
    <Modal open onClose={onClose}>
      <div className="card-glass w-full max-w-lg rounded-2xl border border-border max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-primary" />
            <h2 className="text-lg font-semibold text-heading">{title}</h2>
            <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-muted">
              {pubkeys.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 rounded-lg bg-field px-3 py-2">
            <Search size={14} className="text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE); }}
              placeholder="Search by name or pubkey..."
              className="flex-1 bg-transparent text-sm text-body placeholder:text-muted focus:outline-none"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && pubkeys.length === 0 ? (
            <div className="flex justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              {search ? "No matches found" : `No ${mode} yet`}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((pk, i) => (
                <div
                  key={pk}
                  className="animate-fade-in-up"
                  style={{ animationDelay: `${Math.min(i, 15) * 30}ms` }}
                >
                  <FollowCard pubkey={pk} />
                </div>
              ))}
              {hasMore && (
                <button
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  className="mx-auto mt-2 rounded-lg bg-surface px-4 py-2 text-sm text-soft transition-colors hover:bg-border hover:text-heading"
                >
                  Show more ({filtered.length - visibleCount} remaining)
                </button>
              )}
              {loading && (
                <div className="flex justify-center py-4">
                  <Spinner size="sm" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
