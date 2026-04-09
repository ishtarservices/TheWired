import { useState, useEffect, useCallback, memo, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MessageSquare, FileText, Image, BookOpen, Music, Plus, BellOff, Headphones, Video, Users, ChevronRight } from "lucide-react";
import { useSpace } from "./useSpace";
import { useSpaceChannels } from "./useSpaceChannels";
import { useAppSelector } from "../../store/hooks";
import { usePermissions } from "./usePermissions";
import { parseChannelIdPart } from "./spaceSelectors";
import { getLastChannel } from "../../lib/db/lastChannelCache";
import { useChannelUnread, useChannelMentions, useChannelMuted } from "../notifications/useNotifications";
import { CreateChannelModal } from "./CreateChannelModal";
import { ChannelContextMenu } from "./ChannelContextMenu";
import { VoiceChannelPreview } from "../voice/VoiceChannelPreview";
import { useVoiceRoomPresence } from "../voice/useVoiceRoomPresence";
import { selectIsInChannel, selectVoiceParticipantCount, selectChannelPresence } from "../voice/voiceSelectors";
import { FRIENDS_FEED_ID, FRIENDS_FEED_CHANNELS } from "../friends/friendsFeedConstants";
import type { SpaceChannel, SpaceChannelType } from "../../types/space";

const CHANNEL_ICONS: Record<SpaceChannelType, typeof MessageSquare> = {
  chat: MessageSquare,
  notes: FileText,
  media: Image,
  articles: BookOpen,
  music: Music,
  voice: Headphones,
  video: Video,
};

export function ChannelList() {
  const { activeSpace, activeChannelId, selectChannel } = useSpace();
  const { channels: backendChannels } = useSpaceChannels(
    activeSpace?.id && activeSpace.id !== FRIENDS_FEED_ID ? activeSpace.id : null,
  );
  const navigate = useNavigate();
  const location = useLocation();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const { can, channelOverrides } = usePermissions(activeSpace?.id ?? null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);

  // Per-account localStorage key prefix
  const keyPrefix = currentPubkey ? `${currentPubkey}:` : "";

  // Top-level channels collapse (separate from category collapse)
  const channelsCollapseKey = `${keyPrefix}sidebar_channels_collapsed`;
  const [channelsCollapsed, setChannelsCollapsed] = useState(() => {
    try { return localStorage.getItem(channelsCollapseKey) === "true"; }
    catch { return false; }
  });

  const toggleChannels = useCallback(() => {
    setChannelsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(channelsCollapseKey, String(next));
      return next;
    });
  }, [channelsCollapseKey]);

  // Track collapsed categories in localStorage (per-account + per-space)
  const categoryKey = activeSpaceId ? `${keyPrefix}collapsed_categories:${activeSpaceId}` : null;
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => {
    if (!categoryKey) return new Set();
    try {
      const stored = localStorage.getItem(categoryKey);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Reset collapsed state when switching spaces or accounts
  useEffect(() => {
    if (!categoryKey) return;
    try {
      const stored = localStorage.getItem(categoryKey);
      setCollapsedCategories(stored ? new Set(JSON.parse(stored)) : new Set());
    } catch {
      setCollapsedCategories(new Set());
    }
  }, [categoryKey]);

  const toggleCategory = useCallback((categoryId: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      if (categoryKey) {
        localStorage.setItem(categoryKey, JSON.stringify([...next]));
      }
      return next;
    });
  }, [categoryKey]);

  // Use Friends Feed channels for virtual space
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;
  const channels: SpaceChannel[] = isFriendsFeed ? FRIENDS_FEED_CHANNELS : backendChannels;

  // Poll backend for voice room presence (visible to all space members)
  useVoiceRoomPresence(activeSpace?.id && !isFriendsFeed ? activeSpace.id : null);

  const handleChannelContextMenu = useCallback((e: React.MouseEvent, channelId: string) => {
    e.preventDefault();
    setCtxMenu({ channelId, x: e.clientX, y: e.clientY });
  }, []);

  // When channels load and the current activeChannelId is null or doesn't match
  // any loaded channel (e.g. stale "chat" fallback), auto-select the best default
  useEffect(() => {
    if ((!activeSpace && !isFriendsFeed) || channels.length === 0) return;

    const channelIdPart = parseChannelIdPart(activeChannelId);
    const isValid = channels.some((c) => c.id === channelIdPart);

    if (!isValid) {
      const spaceId = isFriendsFeed ? FRIENDS_FEED_ID : activeSpace!.id;
      // Restore last-visited channel if it still exists
      const lastId = getLastChannel(spaceId);
      const restored = lastId ? channels.find((c) => c.id === lastId) : undefined;
      if (restored) {
        selectChannel(restored.id);
        return;
      }
      // Filter: hide chat for read-only spaces
      const visible =
        !isFriendsFeed && activeSpace?.mode === "read"
          ? channels.filter((c) => c.type !== "chat")
          : channels;
      const sorted = [...(visible.length > 0 ? visible : channels)].sort(
        (a, b) => a.position - b.position,
      );
      const best = sorted.find((c) => c.isDefault) ?? sorted[0];
      if (best) {
        selectChannel(best.id);
      }
    }
  }, [activeSpace, activeChannelId, channels, selectChannel, isFriendsFeed]);

  if (!activeSpace && !isFriendsFeed) return null;

  const spaceId = isFriendsFeed ? FRIENDS_FEED_ID : activeSpace!.id;

  // Use backend permissions if available, fall back to local admin check
  const isAdmin = !isFriendsFeed && (
    can("MANAGE_CHANNELS") || (!!currentPubkey && activeSpace!.adminPubkeys.includes(currentPubkey))
  );

  const handleSelectChannel = (channelId: string) => {
    selectChannel(channelId);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const sortedChannels = [...channels].sort((a, b) => a.position - b.position);

  // Check if onboarding is pending for this space (limits to default channels)
  const onboardingPending = useAppSelector(
    (s) => !isFriendsFeed && activeSpace ? s.spaceConfig.onboardingPending[activeSpace.id] ?? false : false,
  );

  // Filter channels: read-only hides chat, VIEW_CHANNEL hides channels with explicit deny overrides.
  // When onboarding is pending, only show default channels.
  const visibleChannels = sortedChannels.filter((ch) => {
    if (isFriendsFeed) return true;
    if (ch.type === "chat" && activeSpace?.mode === "read") return false;
    if (onboardingPending && !ch.isDefault && !isAdmin) return false;
    const ov = channelOverrides[ch.id];
    if (ov?.deny.includes("VIEW_CHANNEL") && !isAdmin) return false;
    return true;
  });

  // Group channels by categoryId
  const groupedChannels = useMemo(() => {
    const groups: { categoryId: string | null; channels: SpaceChannel[] }[] = [];
    const categoryMap = new Map<string | null, SpaceChannel[]>();

    for (const ch of visibleChannels) {
      const cat = ch.categoryId ?? null;
      if (!categoryMap.has(cat)) {
        categoryMap.set(cat, []);
        groups.push({ categoryId: cat, channels: categoryMap.get(cat)! });
      }
      categoryMap.get(cat)!.push(ch);
    }

    return groups;
  }, [visibleChannels]);

  const hasCategories = groupedChannels.some((g) => g.categoryId !== null);

  return (
    <div className="p-3 space-y-1">
      <div className="mb-1 flex items-center justify-between px-2">
        <button
          onClick={toggleChannels}
          className="flex items-center gap-1 group"
        >
          <ChevronRight
            size={10}
            className={cn(
              "text-muted transition-transform duration-150",
              !channelsCollapsed && "rotate-90",
            )}
          />
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted group-hover:text-heading transition-colors">
            Channels
          </span>
          {channelsCollapsed && (
            <CollapsedUnreadBadge spaceId={spaceId} channels={visibleChannels} />
          )}
        </button>
        {isAdmin && (
          <button
            onClick={() => setCreateModalOpen(true)}
            className="rounded p-0.5 text-muted hover:bg-card/50 hover:text-heading transition-colors"
            title="Create channel"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {!channelsCollapsed && onboardingPending && (
        <div className="mx-2 mb-1 rounded-lg bg-primary/5 border border-primary/10 px-2.5 py-1.5">
          <p className="text-[10px] text-primary leading-snug">
            Complete onboarding to unlock all channels
          </p>
        </div>
      )}

      {!channelsCollapsed && (
        hasCategories ? (
          groupedChannels.map((group) => {
            const isCollapsed = group.categoryId ? collapsedCategories.has(group.categoryId) : false;

            return (
              <div key={group.categoryId ?? "__ungrouped__"}>
                {group.categoryId && (
                  <CategoryHeader
                    categoryId={group.categoryId}
                    spaceId={spaceId}
                    channels={group.channels}
                    isCollapsed={isCollapsed}
                    onToggle={() => toggleCategory(group.categoryId!)}
                  />
                )}
                {!isCollapsed && group.channels.map((ch) => (
                  <ChannelItem
                    key={ch.id}
                    ch={ch}
                    spaceId={spaceId}
                    activeChannelId={activeChannelId}
                    isFriendsFeed={isFriendsFeed}
                    onSelect={handleSelectChannel}
                    onContextMenu={handleChannelContextMenu}
                  />
                ))}
              </div>
            );
          })
        ) : (
          visibleChannels.map((ch) => (
            <ChannelItem
              key={ch.id}
              ch={ch}
              spaceId={spaceId}
              activeChannelId={activeChannelId}
              isFriendsFeed={isFriendsFeed}
              onSelect={handleSelectChannel}
              onContextMenu={handleChannelContextMenu}
            />
          ))
        )
      )}

      {!isFriendsFeed && (
        <>
          <CreateChannelModal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            spaceId={spaceId}
            existingChannels={channels}
          />
          {ctxMenu && (
            <ChannelContextMenu
              open
              onClose={() => setCtxMenu(null)}
              channelId={ctxMenu.channelId}
              position={{ x: ctxMenu.x, y: ctxMenu.y }}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Collapsible category header with aggregated unread */
function CategoryHeader({
  categoryId,
  spaceId,
  channels,
  isCollapsed,
  onToggle,
}: {
  categoryId: string;
  spaceId: string;
  channels: SpaceChannel[];
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex w-full items-center gap-1 px-2 pt-2.5 pb-0.5 group"
    >
      <ChevronRight
        size={10}
        className={cn(
          "text-muted transition-transform duration-150",
          !isCollapsed && "rotate-90",
        )}
      />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted group-hover:text-heading transition-colors">
        {categoryId}
      </span>
      {isCollapsed && (
        <CollapsedUnreadBadge spaceId={spaceId} channels={channels} />
      )}
    </button>
  );
}

/** Shows aggregated unread count for collapsed category */
function CollapsedUnreadBadge({ spaceId, channels }: { spaceId: string; channels: SpaceChannel[] }) {
  const channelUnread = useAppSelector((s) => s.notifications.channelUnread);
  const channelMentions = useAppSelector((s) => s.notifications.channelMentions);

  let totalUnread = 0;
  let totalMentions = 0;
  for (const ch of channels) {
    const key = `${spaceId}:${ch.id}`;
    totalUnread += channelUnread[key] ?? 0;
    totalMentions += channelMentions[key] ?? 0;
  }

  if (totalUnread === 0 && totalMentions === 0) return null;

  return (
    <span
      className={cn(
        "ml-auto flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
        totalMentions > 0 ? "bg-primary" : "bg-surface-hover",
      )}
    >
      {totalMentions > 0 ? totalMentions : totalUnread}
    </span>
  );
}

/** Single channel entry (renders button + optional voice preview) */
function ChannelItem({
  ch,
  spaceId,
  activeChannelId,
  isFriendsFeed,
  onSelect,
  onContextMenu,
}: {
  ch: SpaceChannel;
  spaceId: string;
  activeChannelId: string | null;
  isFriendsFeed: boolean;
  onSelect: (channelId: string) => void;
  onContextMenu: (e: React.MouseEvent, channelId: string) => void;
}) {
  const channelActiveId = `${spaceId}:${ch.id}`;
  const isActive = channelActiveId === activeChannelId;
  const Icon = CHANNEL_ICONS[ch.type] ?? MessageSquare;
  const isVoice = ch.type === "voice" || ch.type === "video";

  return (
    <div>
      <ChannelButton
        channelId={channelActiveId}
        spaceId={spaceId}
        rawChannelId={ch.id}
        label={ch.label}
        isActive={isActive}
        slowModeSeconds={ch.slowModeSeconds}
        isVoiceType={isVoice}
        Icon={Icon}
        onClick={() => onSelect(ch.id)}
        onContextMenu={isFriendsFeed ? undefined : (e) => onContextMenu(e, channelActiveId)}
      />
      {isVoice && !isFriendsFeed && (
        <VoiceChannelPreview spaceId={spaceId} channelId={ch.id} />
      )}
    </div>
  );
}

/** Channel button with unread/mention badges + voice participant count */
const ChannelButton = memo(function ChannelButton({
  channelId,
  spaceId,
  rawChannelId,
  label,
  isActive,
  slowModeSeconds,
  isVoiceType,
  Icon,
  onClick,
  onContextMenu,
}: {
  channelId: string;
  spaceId: string;
  rawChannelId: string;
  label: string;
  isActive: boolean;
  slowModeSeconds: number;
  isVoiceType: boolean;
  Icon: typeof MessageSquare;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const unread = useChannelUnread(channelId);
  const mentions = useChannelMentions(channelId);
  const isMuted = useChannelMuted(channelId);
  const hasUnread = unread > 0 || mentions > 0;

  // Voice/video channel: show participant count from local LiveKit or API presence
  const isConnectedToThis = useAppSelector(selectIsInChannel(spaceId, rawChannelId));
  const voiceParticipantCount = useAppSelector(selectVoiceParticipantCount);
  const channelPresence = useAppSelector(selectChannelPresence(rawChannelId));

  // When connected: use local LiveKit count (+1 for self). Otherwise: use API presence.
  const effectiveCount = isConnectedToThis
    ? voiceParticipantCount + 1
    : channelPresence?.participantCount ?? 0;
  const showVoiceCount = isVoiceType && effectiveCount > 0;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
        isActive
          ? "bg-surface-hover text-heading"
          : hasUnread && !isMuted
            ? "text-heading font-semibold hover:bg-surface-hover"
            : "text-soft hover:bg-surface-hover hover:text-heading",
      )}
    >
      <Icon size={16} className={isConnectedToThis || (isVoiceType && effectiveCount > 0) ? "text-green-400" : undefined} />
      <span className="truncate">{label}</span>
      <span className="ml-auto flex items-center gap-1.5">
        {showVoiceCount && (
          <span className="flex items-center gap-0.5 text-[10px] text-green-400">
            <Users size={10} />
            {effectiveCount}
          </span>
        )}
        {isMuted && (
          <BellOff size={11} className="shrink-0 text-muted" />
        )}
        {mentions > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
            @{mentions}
          </span>
        )}
        {unread > 0 && mentions === 0 && !isMuted && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-hover px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
        {unread > 0 && mentions === 0 && isMuted && (
          <span className="h-2 w-2 rounded-full bg-surface-hover shrink-0" />
        )}
        {slowModeSeconds > 0 && (
          <span className="text-[10px] text-muted" title={`Slow mode: ${slowModeSeconds}s`}>
            🐢
          </span>
        )}
      </span>
    </button>
  );
});
