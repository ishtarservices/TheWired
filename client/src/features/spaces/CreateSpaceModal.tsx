import { useState, useRef, useEffect } from "react";
import { X, Search, Plus, Rss } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { ImageUpload } from "../../components/ui/ImageUpload";
import { Avatar } from "../../components/ui/Avatar";
import { useAppSelector } from "../../store/hooks";
import { BOOTSTRAP_RELAYS, APP_RELAY, NIP29_RELAY_PRESETS } from "../../lib/nostr/constants";
import { registerSpace, addFeedSources } from "../../lib/api/spaces";
import { useAutoResize } from "../../hooks/useAutoResize";
import { useUserSearch } from "../search/useUserSearch";
import { useProfile } from "../profile/useProfile";
import {
  FEATURE_DECENTRALIZED_SPACES,
  selectFeatureEnabled,
} from "../../store/slices/featuresSlice";
import { RelayPicker, type ExtraPreset } from "./RelayPicker";
import type { RelayInfo } from "../../lib/nostr/relayInfo";
import { relayUrlToHost } from "./spaceType";
import { signAndPublish } from "../../lib/nostr/publish";
import { relayManager } from "../../lib/nostr/relayManager";
import { probeRelayNip11 } from "../../lib/nostr/relayInfo";
import { buildCreateGroup, buildEditGroupMetadata } from "../../lib/nostr/eventBuilder";
import {
  embeddedRelaySupported,
  getEmbeddedRelayStatus,
  getTunnelStatus,
  tunnelToRelayUrl,
} from "../../lib/relay/embeddedRelay";
import type { Space, SpaceType } from "../../types/space";

/** Top-level choice in the create modal. "decentralized" reveals the relay
 *  picker; A-lite keeps backend-owned channels/roles but a creator-chosen relay. */
type SpaceKind = "platform" | "decentralized";

/** Within "decentralized": keep Wired features (A-lite) or a standalone,
 *  interoperable NIP-29 group (native). */
type DecentralizedFlavor = "alite" | "native";

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
  const decentralizedEnabled = useAppSelector(
    selectFeatureEnabled(FEATURE_DECENTRALIZED_SPACES),
  );
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [picture, setPicture] = useState("");
  const [mode, setMode] = useState<"read" | "read-write">("read-write");
  const [spaceKind, setSpaceKind] = useState<SpaceKind>("platform");
  const [decentralizedFlavor, setDecentralizedFlavor] = useState<DecentralizedFlavor>("alite");
  const [hostRelay, setHostRelay] = useState<string>(BOOTSTRAP_RELAYS[0]);
  const [relayInfo, setRelayInfo] = useState<RelayInfo | null>(null);
  // The user's self-hosted embedded relay, if running (desktop only). Offered
  // as a host option for NIP-29-native spaces. `publicUrl` is set when a tunnel
  // is up, so a space created here is reachable by others — not just loopback.
  const [embeddedHost, setEmbeddedHost] = useState<{
    url: string;
    publicUrl?: string;
    pubkey: string;
  } | null>(null);
  const [privateGroup, setPrivateGroup] = useState(false);
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

  // When the modal opens, see if a self-hosted relay is running so we can offer
  // it as a host. Reset when closed.
  useEffect(() => {
    if (!open || !embeddedRelaySupported()) {
      setEmbeddedHost(null);
      return;
    }
    let cancelled = false;
    Promise.all([getEmbeddedRelayStatus(), getTunnelStatus().catch(() => null)])
      .then(([s, t]) => {
        if (!cancelled && s.running && s.ws_url && s.pubkey) {
          setEmbeddedHost({
            url: s.ws_url,
            // A running tunnel makes the relay reachable by others.
            publicUrl: t?.running && t.url ? tunnelToRelayUrl(t.url) : undefined,
            pubkey: s.pubkey,
          });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // A-lite spaces can't use strict external NIP-29 relays (0xchat/fiatjaf/…) or
  // a self-hosted relay — those gate on relay-native membership the backend
  // can't reach. If the user picked one for a native space then switches to
  // A-lite, fall back to The Wired's relay so the space isn't born broken.
  useEffect(() => {
    if (decentralizedFlavor !== "alite") return;
    const isStrictExternal = NIP29_RELAY_PRESETS.some((p) => p.url === hostRelay);
    const isSelfHosted =
      !!embeddedHost && (hostRelay === embeddedHost.url || hostRelay === embeddedHost.publicUrl);
    if (isStrictExternal || isSelfHosted) {
      setHostRelay(APP_RELAY);
    }
  }, [decentralizedFlavor, hostRelay, embeddedHost]);

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

    // Resolve the space mode from the (toggle-gated) UI choices.
    const decentralized = decentralizedEnabled && spaceKind === "decentralized";
    const isNative = decentralized && decentralizedFlavor === "native";
    const resolvedHostRelay = decentralized ? hostRelay : BOOTSTRAP_RELAYS[0];
    const spaceType: SpaceType = !decentralized
      ? "platform"
      : isNative
        ? "nip29-native"
        : "decentralized-alite";

    const space: Space = {
      id: spaceId,
      name: name.trim(),
      about: about.trim() || undefined,
      picture: picture.trim() || undefined,
      // Native NIP-29 groups are chat-centric; force read-write.
      mode: isNative ? "read-write" : mode,
      creatorPubkey: pubkey,
      adminPubkeys: [pubkey],
      memberPubkeys: [pubkey],
      feedPubkeys: !isNative && mode === "read" ? feedPubkeys : [],
      hostRelay: resolvedHostRelay,
      isPrivate: isNative ? privateGroup : false,
      createdAt: Math.floor(Date.now() / 1000),
      spaceType,
      channelSource: isNative ? "synthesized" : "backend",
      groupRef: { host: relayUrlToHost(resolvedHostRelay), groupId: spaceId },
    };

    if (isNative) {
      // Relay-authoritative NIP-29 group: publish kind:9007 (create) + 9002
      // (metadata) to the chosen relay. No backend registration.
      try {
        relayManager.connect(resolvedHostRelay, "read+write");
        // Pin the relay's signing key so forged 39000-2 can't inject members/admins.
        // For the self-hosted relay we already know it (loopback NIP-11 probe is
        // CSP-blocked); otherwise probe the relay's NIP-11 document.
        if (
          embeddedHost &&
          (resolvedHostRelay === embeddedHost.url ||
            resolvedHostRelay === embeddedHost.publicUrl)
        ) {
          space.relayPubkey = embeddedHost.pubkey;
        } else {
          const info = await probeRelayNip11(resolvedHostRelay);
          space.relayPubkey = info?.pubkey;
        }
        await signAndPublish(
          buildCreateGroup(pubkey, spaceId, space.name, {
            isPrivate: privateGroup,
            isClosed: privateGroup,
          }),
          [resolvedHostRelay],
        );
        if (space.about || space.picture) {
          await signAndPublish(
            buildEditGroupMetadata(pubkey, spaceId, {
              name: space.name,
              about: space.about,
              picture: space.picture,
            }),
            [resolvedHostRelay],
          );
        }
      } catch (err) {
        console.error("[CreateSpace] NIP-29 group creation failed:", err);
        // Still create locally so the user can retry sending into it.
      }
    } else {
      // Platform / A-lite: bootstrap on the backend FIRST (seeds roles + channels).
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
    }

    // Now navigate to the space
    onCreate(space);

    setName("");
    setAbout("");
    setPicture("");
    setMode("read-write");
    setSpaceKind("platform");
    setDecentralizedFlavor("alite");
    setHostRelay(BOOTSTRAP_RELAYS[0]);
    setRelayInfo(null);
    setPrivateGroup(false);
    setFeedPubkeys([]);
    setSelectedChannels(new Set(["chat", "notes", "media", "articles", "music"]));
    setQuery("");
    setCreating(false);
    onClose();
  }

  // Standalone NIP-29 groups are chat-only — hide the mode/channels/feed UI
  // (those are Wired backend concepts that don't apply).
  const nativeSelected =
    decentralizedEnabled && spaceKind === "decentralized" && decentralizedFlavor === "native";

  // Offer the self-hosted relay only for NIP-29-native spaces: creating one
  // publishes 9007 (so the creator becomes a relay-native member and the
  // publish gate passes). An A-lite space on a loopback relay would have no
  // relay-native membership and its chat would be rejected. We know our embedded
  // relay's capabilities, so supply them directly (no probe). When a tunnel is
  // up we offer the public URL first (reachable by others) plus the local one.
  const embeddedRelayInfo = (url: string): ExtraPreset["info"] => ({
    url,
    name: "Self-hosted relay",
    pubkey: embeddedHost?.pubkey,
    supportedNips: [1, 2, 9, 11, 29, 42, 50],
    supportsNip29: true,
    supportsNip42: true,
    supportsNip50: true,
    authRequired: false,
    paymentRequired: false,
  });
  const embeddedExtraPresets: ExtraPreset[] = embeddedHost
    ? [
        ...(embeddedHost.publicUrl
          ? [
              {
                url: embeddedHost.publicUrl,
                label: "My own relay (public — others can join)",
                info: embeddedRelayInfo(embeddedHost.publicUrl),
              },
            ]
          : []),
        {
          url: embeddedHost.url,
          label: embeddedHost.publicUrl
            ? "My own relay (local only)"
            : "My own relay (self-hosted)",
          info: embeddedRelayInfo(embeddedHost.url),
        },
      ]
    : [];

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
          {/* Space type — only shown when the Decentralized Spaces feature is on.
              When off, this block renders nothing and creation is unchanged. */}
          {decentralizedEnabled && (
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Space type
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSpaceKind("platform")}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    spaceKind === "platform"
                      ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                      : "bg-surface text-soft hover:text-heading"
                  }`}
                >
                  Platform
                </button>
                <button
                  type="button"
                  onClick={() => setSpaceKind("decentralized")}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    spaceKind === "decentralized"
                      ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                      : "bg-surface text-soft hover:text-heading"
                  }`}
                >
                  Decentralized
                </button>
              </div>
              <p className="mt-1 text-xs text-muted">
                {spaceKind === "platform"
                  ? "Hosted on The Wired with full features — the default."
                  : "Same features, but chat lives on a relay you choose."}
              </p>
            </div>
          )}

          {decentralizedEnabled && spaceKind === "decentralized" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-soft">
                  Decentralized type
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setDecentralizedFlavor("alite")}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                      decentralizedFlavor === "alite"
                        ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                        : "bg-surface text-soft hover:text-heading"
                    }`}
                  >
                    Wired features
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecentralizedFlavor("native")}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                      decentralizedFlavor === "native"
                        ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                        : "bg-surface text-soft hover:text-heading"
                    }`}
                  >
                    Standalone NIP-29
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {decentralizedFlavor === "alite"
                    ? "Channels, roles and members stay on The Wired; chat lives on your chosen relay."
                    : "A pure NIP-29 group joinable from other Nostr apps (0xchat, Chachi, Flotilla)."}
                </p>
              </div>

              <RelayPicker
                value={hostRelay}
                onChange={setHostRelay}
                onInfo={setRelayInfo}
                requireAuth={decentralizedFlavor === "native" && privateGroup}
                extraPresets={decentralizedFlavor === "native" ? embeddedExtraPresets : undefined}
                showNip29Presets={decentralizedFlavor === "native"}
              />

              {decentralizedFlavor === "native" && (
                <>
                  <label
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                      relayInfo && !relayInfo.supportsNip42
                        ? "cursor-not-allowed opacity-40"
                        : "cursor-pointer hover:bg-surface-hover"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={privateGroup}
                      disabled={!!relayInfo && !relayInfo.supportsNip42}
                      onChange={(e) => setPrivateGroup(e.target.checked)}
                      className="rounded border-border"
                    />
                    <span className="text-sm text-heading">Private group</span>
                    <span className="text-[11px] text-muted">
                      Members-only — requires a NIP-42 relay
                    </span>
                  </label>

                  <p className="rounded-lg border border-border bg-surface px-3 py-2 text-[11px] text-muted">
                    Interoperable: the <span className="text-soft">chat</span> works in other NIP-29
                    apps. Wired-only extras — notes/media/music feeds, read-only feeds and the
                    multi-channel layout — won&apos;t appear in those apps.
                  </p>
                </>
              )}
            </>
          )}

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

          {!nativeSelected && (
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
          )}

          {/* Channel selection */}
          {!nativeSelected && (
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
          )}

          {/* Feed Sources -- shown only for feed mode */}
          {!nativeSelected && mode === "read" && (
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
