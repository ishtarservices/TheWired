import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, Search, X, Users, Activity, Star, Rss, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setSidebarMode } from "@/store/slices/uiSlice";
import { setChannels, setActiveChannel } from "@/store/slices/spacesSlice";
import { useSpace } from "@/features/spaces/useSpace";
import { switchSpaceChannel } from "@/lib/nostr/groupSubscriptions";
import { joinSpaceApi } from "@/lib/api/spaces";
import { BOOTSTRAP_RELAYS } from "@/lib/nostr/constants";
import type { Space, SpaceChannel } from "@/types/space";
import {
  discoverSpaces,
  discoverFeaturedSpaces,
  getDiscoverCategories,
  discoverRelays,
  type DiscoverSpace,
  type SpaceCategory,
  type DiscoverRelay,
} from "@/lib/api/discover";

type DiscoverTab = "spaces" | "relays" | "people";

const TABS: { id: DiscoverTab; label: string }[] = [
  { id: "spaces", label: "Spaces" },
  { id: "relays", label: "Relays" },
  { id: "people", label: "People" },
];

export function DiscoverPage() {
  const [activeTab, setActiveTab] = useState<DiscoverTab>("spaces");
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div data-tour="discover-page" className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-6 pt-6 pb-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Compass size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-heading">Discover</h1>
            <p className="text-xs text-muted">
              Find spaces, relays, and people
            </p>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex items-center gap-2 rounded-xl bg-field ring-1 ring-border px-3 py-2 mb-4 transition-all focus-within:ring-primary/30">
          <Search size={14} className="text-muted shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search spaces, relays, people..."
            className="w-full bg-transparent text-sm text-heading placeholder-muted outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="text-muted hover:text-heading"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2.5 text-sm font-medium transition-colors border-b-2",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-soft hover:text-heading",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === "spaces" && <DiscoverSpacesTab search={searchQuery} />}
        {activeTab === "relays" && <DiscoverRelaysTab search={searchQuery} />}
        {activeTab === "people" && (
          <DiscoverPlaceholder title="People" description="Discover interesting people and starter packs to follow." />
        )}
      </div>
    </div>
  );
}

// ── Spaces Tab ──────────────────────────────────────────────────

function DiscoverSpacesTab({ search }: { search: string }) {
  const [featured, setFeatured] = useState<DiscoverSpace[]>([]);
  const [trending, setTrending] = useState<DiscoverSpace[]>([]);
  const [categories, setCategories] = useState<SpaceCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [browseSpaces, setBrowseSpaces] = useState<DiscoverSpace[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [previewSpace, setPreviewSpace] = useState<DiscoverSpace | null>(null);

  // Initial load
  useEffect(() => {
    setLoading(true);
    Promise.all([
      discoverFeaturedSpaces().catch(() => ({ data: [] })),
      discoverSpaces({ sort: "trending", limit: 8 }).catch(() => ({ data: [] })),
      getDiscoverCategories().catch(() => ({ data: [] })),
      discoverSpaces({ sort: "popular", limit: 12 }).catch(() => ({ data: [] })),
    ]).then(([feat, trend, cats, browse]) => {
      setFeatured(feat.data);
      setTrending(trend.data);
      setCategories(cats.data);
      setBrowseSpaces(browse.data);
      setLoading(false);
      setHasMore(browse.data.length >= 12);
    });
  }, []);

  // Search/filter
  useEffect(() => {
    if (!search && !activeCategory) return;

    setLoading(true);
    discoverSpaces({
      search: search || undefined,
      category: activeCategory ?? undefined,
      sort: "popular",
      limit: 20,
    })
      .then((res) => {
        setBrowseSpaces(res.data);
        setOffset(0);
        setHasMore(res.data.length >= 20);
      })
      .catch(() => setBrowseSpaces([]))
      .finally(() => setLoading(false));
  }, [search, activeCategory]);

  const loadMore = useCallback(() => {
    const nextOffset = offset + 20;
    discoverSpaces({
      search: search || undefined,
      category: activeCategory ?? undefined,
      sort: "popular",
      limit: 20,
      offset: nextOffset,
    }).then((res) => {
      setBrowseSpaces((prev) => [...prev, ...res.data]);
      setOffset(nextOffset);
      setHasMore(res.data.length >= 20);
    });
  }, [offset, search, activeCategory]);

  const showSearch = !!search;

  return (
    <div className="space-y-8">
      {/* Featured */}
      {!showSearch && featured.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Star size={14} className="text-primary" />
            <h2 className="text-sm font-semibold text-heading">Featured</h2>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {featured.map((space) => (
              <SpaceCard key={space.id} space={space} variant="featured" onClick={() => setPreviewSpace(space)} />
            ))}
          </div>
        </section>
      )}

      {/* Trending */}
      {!showSearch && trending.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Activity size={14} className="text-primary" />
            <h2 className="text-sm font-semibold text-heading">Trending</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {trending.map((space) => (
              <SpaceCard key={space.id} space={space} onClick={() => setPreviewSpace(space)} />
            ))}
          </div>
        </section>
      )}

      {/* Category chips */}
      {categories.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              !activeCategory
                ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                : "bg-card text-soft hover:bg-card-hover hover:text-heading",
            )}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setActiveCategory(cat.slug === activeCategory ? null : cat.slug)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                cat.slug === activeCategory
                  ? "bg-primary/20 text-primary ring-1 ring-primary/40"
                  : "bg-card text-soft hover:bg-card-hover hover:text-heading",
              )}
            >
              {cat.name}
              {cat.spaceCount > 0 && (
                <span className="ml-1 text-muted">{cat.spaceCount}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Browse / Search Results */}
      <section>
        <h2 className="text-sm font-semibold text-heading mb-3">
          {showSearch ? "Search Results" : activeCategory ? categories.find((c) => c.slug === activeCategory)?.name ?? "Browse" : "Browse All"}
        </h2>
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <SpaceCardSkeleton key={i} />
            ))}
          </div>
        ) : browseSpaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Compass size={24} className="text-muted opacity-30 mb-2" />
            <p className="text-xs text-muted">No spaces found</p>
            <p className="text-xs text-faint mt-1">Try different keywords or categories</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {browseSpaces.map((space) => (
                <SpaceCard key={space.id} space={space} onClick={() => setPreviewSpace(space)} />
              ))}
            </div>
            {hasMore && (
              <button
                onClick={loadMore}
                className="mt-4 w-full rounded-xl border border-border px-4 py-2 text-xs text-muted hover:border-primary/40 hover:text-primary transition-colors"
              >
                Load More
              </button>
            )}
          </>
        )}
      </section>

      {/* Space Preview Modal */}
      <SpacePreviewModal
        space={previewSpace}
        onClose={() => setPreviewSpace(null)}
      />
    </div>
  );
}

// ── Relays Tab ──────────────────────────────────────────────────

function DiscoverRelaysTab({ search }: { search: string }) {
  const [relays, setRelays] = useState<DiscoverRelay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    discoverRelays({ search: search || undefined, sort: "popular", limit: 30 })
      .then((res) => setRelays(res.data))
      .catch(() => setRelays([]))
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <div className="space-y-6">
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <SpaceCardSkeleton key={i} />
          ))}
        </div>
      ) : relays.length === 0 ? (
        <DiscoverPlaceholder
          title="No Relays Yet"
          description="Relay directory will populate as relay data is collected from the network."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {relays.map((relay) => (
            <RelayCard key={relay.url} relay={relay} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Space Card ──────────────────────────────────────────────────

function SpaceCard({ space, variant, onClick }: { space: DiscoverSpace; variant?: "featured"; onClick?: () => void }) {
  const isFeatured = variant === "featured";
  const isReadOnly = space.mode === "read";

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl card-glass border border-border p-4 transition-all duration-200 hover:border-primary/30 hover:shadow-lg cursor-pointer",
        isFeatured && "w-64 shrink-0",
      )}
    >
      <div className="flex items-start gap-3">
        <Avatar src={space.picture} alt={space.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-heading truncate">{space.name}</h3>
            {isReadOnly && (
              <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                <Rss size={8} />
                Feed
              </span>
            )}
          </div>
          {space.about && (
            <p className="text-xs text-soft line-clamp-2 mt-0.5">{space.about}</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="flex items-center gap-3 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <Users size={10} />
            {space.memberCount}
          </span>
          {space.activeMembers24h > 0 && (
            <span className="flex items-center gap-1">
              <Activity size={10} className="text-green-400" />
              {space.activeMembers24h} active
            </span>
          )}
        </div>
        {space.tags.length > 0 && (
          <div className="flex gap-1">
            {space.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-card px-1.5 py-0.5 text-[9px] text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SpaceCardSkeleton() {
  return (
    <div className="rounded-xl card-glass border border-border p-4 animate-pulse">
      <div className="flex items-center gap-3 mb-2">
        <div className="h-8 w-8 rounded-full bg-card-hover/60" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3 w-20 rounded bg-card-hover/60" />
          <div className="h-2.5 w-28 rounded bg-card-hover/40" />
        </div>
      </div>
      <div className="flex gap-1.5 mt-2">
        <div className="h-4 w-12 rounded-full bg-card-hover/30" />
        <div className="h-4 w-16 rounded-full bg-card-hover/30" />
      </div>
    </div>
  );
}

// ── Space Preview Modal ────────────────────────────────────────

function SpacePreviewModal({ space, onClose }: { space: DiscoverSpace | null; onClose: () => void }) {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { joinSpace } = useSpace();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const mySpaces = useAppSelector((s) => s.spaces.list);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alreadyJoined = space ? mySpaces.some((s) => s.id === space.id) : false;

  const handleJoin = async () => {
    if (!space || !myPubkey) return;

    setJoining(true);
    setError(null);

    try {
      const res = await joinSpaceApi(space.id);
      const { space: spaceData, channels, feedPubkeys } = res.data;

      // Store channels in Redux BEFORE joinSpace so they're available
      // Normalize channels to ensure feedMode is present (backward compat)
      const normalizedChannels: SpaceChannel[] = channels.map((ch: any) => ({
        ...ch,
        feedMode: ch.feedMode ?? "all",
      }));
      dispatch(setChannels({ spaceId: space.id, channels: normalizedChannels }));

      const spaceMode = (spaceData.mode as "read" | "read-write") ?? "read-write";

      // Build the full space object with feed sources included
      const spaceObj: Space = {
        id: space.id,
        name: spaceData.name,
        about: spaceData.about ?? undefined,
        picture: spaceData.picture ?? undefined,
        mode: spaceMode,
        creatorPubkey: spaceData.creatorPubkey ?? "",
        adminPubkeys: spaceData.creatorPubkey ? [spaceData.creatorPubkey] : [],
        memberPubkeys: [myPubkey],
        feedPubkeys: feedPubkeys ?? [],
        hostRelay: spaceData.hostRelay || BOOTSTRAP_RELAYS[0],
        isPrivate: false,
        createdAt: Math.floor(Date.now() / 1000),
      };

      // joinSpace adds space to Redux + IndexedDB, sets it active, enters
      // subscriptions. But it can't find channels (stale closure), so we
      // manually select the default channel afterward.
      joinSpace(spaceObj);

      // Manually pick the default channel and create the Nostr subscription
      // since joinSpace's allChannels closure is stale.
      if (normalizedChannels.length > 0) {
        const visible = spaceMode === "read"
          ? normalizedChannels.filter((c: SpaceChannel) => c.type !== "chat")
          : normalizedChannels;
        const sorted = [...visible].sort((a: SpaceChannel, b: SpaceChannel) => a.position - b.position);
        const best = sorted.find((c: SpaceChannel) => c.isDefault) ?? sorted[0];
        if (best) {
          const channelId = `${space.id}:${best.id}`;
          dispatch(setActiveChannel(channelId));
          switchSpaceChannel(spaceObj, best.type, best.id);
        }
      }

      dispatch(setSidebarMode("spaces"));
      navigate("/");
      onClose();
    } catch (err: any) {
      if (err?.code === "ALREADY_MEMBER") {
        setError("You're already a member of this space.");
      } else if (err?.status === 401) {
        setError("Please sign in to join spaces.");
      } else {
        setError(err?.message ?? "Failed to join space. Please try again.");
      }
    } finally {
      setJoining(false);
    }
  };

  // Reset error when space changes
  useEffect(() => {
    setError(null);
  }, [space?.id]);

  if (!space) return null;

  const isReadOnly = space.mode === "read";

  return (
    <Modal open={!!space} onClose={onClose}>
      <div className="w-full max-w-md rounded-2xl card-glass p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start gap-4 mb-4">
          <Avatar src={space.picture} alt={space.name} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-heading truncate">{space.name}</h2>
              {isReadOnly && (
                <span className="shrink-0 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <Rss size={9} />
                  Feed
                </span>
              )}
            </div>
            {space.category && (
              <p className="text-[11px] text-muted capitalize mt-0.5">{space.category.replace(/-/g, " ")}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Description */}
        {space.about && (
          <p className="text-xs text-soft leading-relaxed mb-4">{space.about}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 mb-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <Users size={12} />
            {space.memberCount} member{space.memberCount !== 1 ? "s" : ""}
          </span>
          {space.activeMembers24h > 0 && (
            <span className="flex items-center gap-1.5">
              <Activity size={12} className="text-green-400" />
              {space.activeMembers24h} active now
            </span>
          )}
          {isReadOnly && (
            <span className="flex items-center gap-1.5 text-primary/70">
              <Rss size={12} />
              Read-only feed
            </span>
          )}
        </div>

        {/* Tags */}
        {space.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {space.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-card border border-border px-2 py-0.5 text-[10px] text-muted"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 mb-4">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-red-400" />
            <p className="text-xs text-red-300">{error}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          {alreadyJoined ? (
            <Button variant="secondary" size="md" onClick={() => { dispatch(setSidebarMode("spaces")); navigate("/"); onClose(); }}>
              Go to Space
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={handleJoin}
              disabled={joining || !myPubkey}
            >
              {joining ? <Spinner size="sm" /> : "Join Space"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Relay Card ──────────────────────────────────────────────────

function RelayCard({ relay }: { relay: DiscoverRelay }) {
  const url = relay.url.replace(/^wss?:\/\//, "");

  return (
    <div className="rounded-xl card-glass border border-border p-4 transition-all duration-200 hover:border-primary/30">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
          <span className="text-xs font-bold text-primary">
            {url.charAt(0).toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-heading truncate">{url}</h3>
          {relay.description && (
            <p className="text-xs text-soft line-clamp-1 mt-0.5">{relay.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 mt-3">
        {relay.supportedNips && relay.supportedNips.length > 0 && (
          <div className="flex gap-1">
            {relay.supportedNips.slice(0, 4).map((nip) => (
              <span
                key={nip}
                className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary"
              >
                NIP-{nip}
              </span>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 text-[10px] text-muted">
          {relay.rttMs != null && (
            <span className={cn(
              relay.rttMs < 100 ? "text-green-400" : relay.rttMs < 500 ? "text-yellow-400" : "text-red-400",
            )}>
              {relay.rttMs}ms
            </span>
          )}
          {relay.userCount > 0 && (
            <span>{relay.userCount} users</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Placeholder ─────────────────────────────────────────────────

function DiscoverPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Compass size={32} className="text-muted opacity-30 mb-3" />
      <h3 className="text-sm font-semibold text-heading">{title}</h3>
      <p className="mt-1 text-xs text-muted max-w-sm">{description}</p>
      <p className="mt-3 text-xs text-faint">Coming soon</p>
    </div>
  );
}
