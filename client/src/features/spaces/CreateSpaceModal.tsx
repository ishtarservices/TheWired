import { useState, useRef, useEffect } from "react";
import { X, Search, Plus, Rss } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { ImageUpload } from "../../components/ui/ImageUpload";
import { Avatar } from "../../components/ui/Avatar";
import { useAppSelector } from "../../store/hooks";
import { BOOTSTRAP_RELAYS } from "../../lib/nostr/constants";
import { registerSpace, addFeedSources } from "../../lib/api/spaces";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useUserSearch } from "../search/useUserSearch";
import { useProfile } from "../profile/useProfile";
import type { Space } from "../../types/space";

interface CreateSpaceModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (space: Space) => void;
}

const CHANNEL_TYPE_OPTIONS = [
  {
    type: "chat",
    label: "Chat",
    isFeed: false,
    description: "Real-time messaging",
    feedDescription: "Real-time messaging",
  },
  {
    type: "notes",
    label: "Notes",
    isFeed: true,
    description: "Short-form posts from members",
    feedDescription: "Short-form posts from feed sources",
  },
  {
    type: "media",
    label: "Media",
    isFeed: true,
    description: "Images & videos from members",
    feedDescription: "Images & videos from feed sources",
  },
  {
    type: "articles",
    label: "Articles",
    isFeed: true,
    description: "Long-form posts from members",
    feedDescription: "Articles from feed sources",
  },
  {
    type: "music",
    label: "Music",
    isFeed: true,
    description: "Music shared by members",
    feedDescription: "Music shared by feed sources",
  },
] as const;

function generateId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function FeedSourceChip({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-surface-hover px-2 py-1">
      <Avatar src={profile?.picture} alt={name} size="xs" />
      <span className="text-xs text-heading truncate max-w-[120px]">{name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 text-muted hover:text-heading hover:bg-surface-hover transition-colors"
      >
        <X size={10} />
      </button>
    </div>
  );
}

export function CreateSpaceModal({
  open,
  onClose,
  onCreate,
}: CreateSpaceModalProps) {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [mode, setMode] = useState<"read" | "read-write">("read-write");
  const [feedPubkeys, setFeedPubkeys] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(
    new Set(["chat", "notes", "media", "articles", "music"]),
  );
  const aboutRef = useRef<HTMLTextAreaElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  useAutoResize(aboutRef, about, 200);

  // Auto-exclude chat when mode is read-only, re-add when switching back
  useEffect(() => {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (mode === "read") {
        next.delete("chat");
      } else if (!next.has("chat")) {
        next.add("chat");
      }
      return next;
    });
  }, [mode]);

  const { query, setQuery, results, isSearching } = useUserSearch();

  function addFeedSource(pk: string) {
    if (!feedPubkeys.includes(pk)) {
      setFeedPubkeys((prev) => [...prev, pk]);
    }
    setQuery("");
  }

  function toggleChannel(type: string) {
    setSelectedChannels((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function removeFeedSource(pk: string) {
    setFeedPubkeys((prev) => prev.filter((p) => p !== pk));
  }

  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!name.trim() || !pubkey || creating) return;
    setCreating(true);

    const spaceId = generateId();

    const space: Space = {
      id: spaceId,
      name: name.trim(),
      about: about.trim() || undefined,
      picture: picture.trim() || undefined,
      mode,
      creatorPubkey: pubkey,
      adminPubkeys: [pubkey],
      memberPubkeys: [pubkey],
      feedPubkeys: mode === "read" ? feedPubkeys : [],
      hostRelay: BOOTSTRAP_RELAYS[0],
      isPrivate: false,
      createdAt: Math.floor(Date.now() / 1000),
    };

    // Bootstrap space on backend FIRST (seeds roles + channels)
    const channelList = Array.from(selectedChannels).map((type) => ({
      type,
      label: `#${type}`,
    }));

    try {
      await registerSpace({
        id: space.id,
        name: space.name,
        hostRelay: space.hostRelay,
        picture: space.picture,
        about: space.about,
        mode: space.mode,
        channels: channelList,
      });

      // Register feed sources after space is created
      if (mode === "read" && feedPubkeys.length > 0) {
        addFeedSources(spaceId, feedPubkeys).catch((err) => {
          console.error("[CreateSpace] Feed sources registration failed:", err);
        });
      }
    } catch (err) {
      console.error("[CreateSpace] Backend bootstrap failed:", err);
      // Still create locally so the space appears even if backend is down
    }

    // Now navigate to the space (backend has channels ready)
    onCreate(space);

    setName("");
    setAbout("");
    setPicture("");
    setMode("read-write");
    setFeedPubkeys([]);
    setSelectedChannels(new Set(["chat", "notes", "media", "articles", "music"]));
    setQuery("");
    setCreating(false);
    onClose();
  }

  // Filter out already-added pubkeys from search results
  const filteredResults = results.filter((r) => !feedPubkeys.includes(r.pubkey));
  const showDropdown = query.trim() && (filteredResults.length > 0 || isSearching);

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Create Space</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Space"
              className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Description
            </label>
            <textarea
              ref={aboutRef}
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="What's this space about?"
              rows={2}
              className="w-full resize-none overflow-hidden rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
            />
          </div>

          <ImageUpload
            value={picture}
            onChange={setPicture}
            label="Picture"
            placeholder="Drop space image or click to upload"
            shape="square"
          />

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Mode
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setMode("read-write")}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  mode === "read-write"
                    ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                    : "bg-surface text-soft hover:text-heading"
                }`}
              >
                Community (Read-write)
              </button>
              <button
                onClick={() => setMode("read")}
                className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                  mode === "read"
                    ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                    : "bg-surface text-soft hover:text-heading"
                }`}
              >
                Feed (Read-only)
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">
              {mode === "read"
                ? "Curated feed -- add users whose content appears in this space"
                : "Full community with chat, notes, media, and articles"}
            </p>
          </div>

          {/* Channel selection */}
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Channels
            </label>
            <p className="mb-2 text-[11px] text-muted">
              {mode === "read"
                ? "Feed channels show content your feed sources publish in each format. You can add more later in settings."
                : "Feed channels aggregate content members post in each format. You can add more later in settings."}
            </p>
            <div className="space-y-1">
              {CHANNEL_TYPE_OPTIONS.map((opt) => {
                const disabled = opt.type === "chat" && mode === "read";
                const description = mode === "read" ? opt.feedDescription : opt.description;
                return (
                  <label
                    key={opt.type}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                      disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-hover cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannels.has(opt.type)}
                      onChange={() => toggleChannel(opt.type)}
                      disabled={disabled}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-heading">{opt.label}</span>
                    {opt.isFeed && (
                      <span className="flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                        <Rss size={8} />
                        Feed
                      </span>
                    )}
                    <span className="text-[11px] text-muted">{description}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted/70">
              Custom names, categories, voice/video, and multiple chats can be added after creation.
            </p>
          </div>

          {/* Feed Sources -- shown only for feed mode */}
          {mode === "read" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Feed Sources
              </label>
              <p className="mb-2 text-[11px] text-muted">
                Add users whose posts will appear in this feed. You can also add more later.
              </p>

              {/* Search input */}
              <div ref={searchContainerRef} className="relative mb-2">
                <div className="flex items-center gap-2 rounded-xl bg-field border border-border px-3 py-1.5 focus-within:border-primary transition-colors">
                  <Search size={14} className="text-muted shrink-0" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by name or paste npub..."
                    className="flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} className="text-muted hover:text-heading">
                      <X size={12} />
                    </button>
                  )}
                </div>

                {showDropdown && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl card-glass shadow-lg">
                    {isSearching && filteredResults.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted">Searching...</p>
                    )}
                    {filteredResults.map((r) => (
                      <button
                        key={r.pubkey}
                        onClick={() => addFeedSource(r.pubkey)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-card-hover/30 transition-colors"
                      >
                        <Avatar src={r.profile.picture} alt={r.profile.display_name || r.profile.name || ""} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-heading">
                            {r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8) + "..."}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {r.profile.nip05 || r.pubkey.slice(0, 12) + "..."}
                          </p>
                        </div>
                        <Plus size={14} className="text-muted shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Added feed sources */}
              {feedPubkeys.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {feedPubkeys.map((pk) => (
                    <FeedSourceChip key={pk} pubkey={pk} onRemove={() => removeFeedSource(pk)} />
                  ))}
                </div>
              )}

              {feedPubkeys.length === 0 && (
                <p className="text-[11px] text-muted/60 italic">
                  No feed sources added yet
                </p>
              )}
            </div>
          )}

        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
          >
            {creating ? "Creating..." : "Create Space"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
