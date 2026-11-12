import { useState, useEffect, useCallback, memo, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { MessageSquare, FileText, Image, BookOpen, Music, Plus, BellOff, Headphones, Video, Users, ChevronRight, FolderPlus } from "lucide-react";
import { useSpace } from "./useSpace";
import { useSpaceChannels } from "./useSpaceChannels";
import { useAppSelector } from "../../store/hooks";
import { usePermissions } from "./usePermissions";
import { parseChannelIdPart } from "./spaceSelectors";
import { getLastChannel } from "../../lib/db/lastChannelCache";
import { useChannelUnread, useChannelMentions, useChannelMuted } from "../notifications/useNotifications";
import { CreateChannelModal } from "./CreateChannelModal";
import { EditChannelModal } from "./EditChannelModal";
import { CategoryModal } from "./CategoryModal";
import { ChannelContextMenu } from "./ChannelContextMenu";
import { CategoryContextMenu } from "./CategoryContextMenu";
import { ChannelTreeDnd, type DragHandle } from "./ChannelTreeDnd";
import {
  buildChannelTree,
  filterTree,
  flattenTree,
  moveCategory,
  moveChannel,
  removeCategory,
  visibleToFullIndex,
} from "./channelTree";
import { isNip29Native } from "./spaceType";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
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
  const spaceIdForChannels = activeSpace?.id && activeSpace.id !== FRIENDS_FEED_ID ? activeSpace.id : null;
  const {
    channels: backendChannels,
    tree: backendTree,
    layoutManageable,
    applyOp,
    deleteChannel,
  } = useSpaceChannels(spaceIdForChannels);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const { can, channelOverrides } = usePermissions(activeSpace?.id ?? null);
  const [createModal, setCreateModal] = useState<{ categoryId: string | null } | null>(null);
  const [categoryModal, setCategoryModal] = useState<{ categoryId: string | null } | null>(null);
  const [editChannelId, setEditChannelId] = useState<string | null>(null);
  const [deleteChannelId, setDeleteChannelId] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ channelId: string; x: number; y: number } | null>(null);
  const [catMenu, setCatMenu] = useState<{ categoryId: string; x: number; y: number } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

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
      try { localStorage.setItem(channelsCollapseKey, String(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [channelsCollapseKey]);

  // Collapsed subfolders in localStorage (per-account + per-space), keyed by the
  // category's stable id (pre-existing subfolders kept their name as their id,
  // so collapse state saved before subfolders were editable still applies).
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
        try { localStorage.setItem(categoryKey, JSON.stringify([...next])); } catch { /* storage unavailable */ }
      }
      return next;
    });
  }, [categoryKey]);

  // Use Friends Feed channels for virtual space
  const isFriendsFeed = activeSpaceId === FRIENDS_FEED_ID;
  const channels: SpaceChannel[] = isFriendsFeed ? FRIENDS_FEED_CHANNELS : backendChannels;
  const fullTree = useMemo(
    () => (isFriendsFeed ? buildChannelTree(FRIENDS_FEED_CHANNELS, []) : backendTree),
    [isFriendsFeed, backendTree],
  );

  // Poll backend for voice room presence (visible to all space members)
  useVoiceRoomPresence(activeSpace?.id && !isFriendsFeed ? activeSpace.id : null);

  // Check if onboarding is pending for this space (limits to default channels)
  const onboardingPending = useAppSelector(
    (s) => !isFriendsFeed && activeSpace ? s.spaceConfig.onboardingPending[activeSpace.id] ?? false : false,
  );

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

  // Use backend permissions if available, fall back to local admin check
  const isAdmin = !isFriendsFeed && !!activeSpace && (
    can("MANAGE_CHANNELS") || (!!currentPubkey && activeSpace.adminPubkeys.includes(currentPubkey))
  );
  const canArrange = isAdmin && layoutManageable;

  // Filter channels: read-only hides chat, VIEW_CHANNEL hides channels with explicit deny overrides.
  // When onboarding is pending, only show default channels.
  const visibleTree = useMemo(
    () =>
      filterTree(fullTree, (ch) => {
        if (isFriendsFeed) return true;
        if (ch.type === "chat" && activeSpace?.mode === "read") return false;
        if (onboardingPending && !ch.isDefault && !isAdmin) return false;
        const ov = channelOverrides[ch.id];
        if (ov?.deny.includes("VIEW_CHANNEL") && !isAdmin) return false;
        return true;
      }),
    [fullTree, isFriendsFeed, activeSpace?.mode, onboardingPending, isAdmin, channelOverrides],
  );
  const visibleChannels = useMemo(() => flattenTree(visibleTree), [visibleTree]);

  const moveTargets = useMemo(
    () => [
      { id: null as string | null, name: "No subfolder" },
      ...fullTree.categories.map((n) => ({ id: n.category.id as string | null, name: n.category.name })),
    ],
    [fullTree],
  );

  const runMove = useCallback(
    (op: Parameters<typeof applyOp>[0]) => {
      setMoveError(null);
      applyOp(op).catch((err: unknown) => {
        setMoveError(err instanceof Error ? err.message : "Couldn't move that");
      });
    },
    [applyOp],
  );

  if (!activeSpace && !isFriendsFeed) return null;

  const spaceId = isFriendsFeed ? FRIENDS_FEED_ID : activeSpace!.id;

  const handleSelectChannel = (channelId: string) => {
    selectChannel(channelId);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const ctxChannel = ctxMenu ? channels.find((c) => `${spaceId}:${c.id}` === ctxMenu.channelId) : undefined;
  const deleteTarget = deleteChannelId ? channels.find((c) => c.id === deleteChannelId) : undefined;
  const deleteCategory = deleteCategoryId
    ? fullTree.categories.find((n) => n.category.id === deleteCategoryId)
    : undefined;
  const catMenuNode = catMenu ? fullTree.categories.find((n) => n.category.id === catMenu.categoryId) : undefined;
  const nativeSpace = !!activeSpace && isNip29Native(activeSpace);

  return (
    <div className="px-2 py-3 space-y-0.5">
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
          <span className="label-caps group-hover:text-heading transition-colors">
            Channels
          </span>
          {channelsCollapsed && (
            <CollapsedUnreadBadge spaceId={spaceId} channels={visibleChannels} />
          )}
        </button>
        {isAdmin && (
          <div className="flex items-center gap-0.5">
            {layoutManageable && (
              <button
                onClick={() => setCategoryModal({ categoryId: null })}
                className="rounded p-0.5 text-muted hover:bg-card/50 hover:text-heading transition-colors"
                title="New subfolder"
                aria-label="New subfolder"
              >
                <FolderPlus size={14} />
              </button>
            )}
            <button
              onClick={() => setCreateModal({ categoryId: null })}
              className="rounded p-0.5 text-muted hover:bg-card/50 hover:text-heading transition-colors"
              title="Create channel"
              aria-label="Create channel"
            >
              <Plus size={14} />
            </button>
          </div>
        )}
      </div>

      {!channelsCollapsed && onboardingPending && (
        <div className="mx-2 mb-1 rounded-lg bg-primary/5 border border-primary/10 px-2 py-1.5">
          <p className="text-[10px] text-primary leading-snug">
            Complete onboarding to unlock all channels
          </p>
        </div>
      )}

      {moveError && (
        <p className="mx-2 rounded-lg bg-red-500/10 px-2 py-1 text-[10px] text-red-400" role="alert">
          {moveError}
        </p>
      )}

      {!channelsCollapsed && (
        <ChannelTreeDnd
          tree={visibleTree}
          enabled={canArrange}
          collapsed={collapsedCategories}
          // Members only see subfolders that hold a channel they can see.
          showCategory={(node) => isAdmin || node.channels.length > 0}
          onMoveChannel={(channelId, toCategoryId, index) =>
            runMove(
              moveChannel(
                channelId,
                toCategoryId,
                visibleToFullIndex(fullTree, visibleTree, channelId, toCategoryId, index),
              ),
            )
          }
          onMoveCategory={(categoryId, index) => runMove(moveCategory(categoryId, index))}
          emptyCategoryHint={
            <p className="px-3 py-1.5 text-[10px] italic text-muted">Drag channels here</p>
          }
          renderCategoryHeader={(node, ctx) => (
            <CategoryHeader
              name={node.category.name}
              spaceId={spaceId}
              channels={node.channels}
              isCollapsed={collapsedCategories.has(node.category.id)}
              onToggle={() => toggleCategory(node.category.id)}
              onAdd={isAdmin ? () => setCreateModal({ categoryId: node.category.id }) : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                setCatMenu({ categoryId: node.category.id, x: e.clientX, y: e.clientY });
              }}
              dragHandle={ctx.handle}
              dropTarget={ctx.dropTarget}
              overlay={ctx.overlay}
            />
          )}
          renderChannel={(ch, ctx) => (
            <ChannelItem
              ch={ch}
              spaceId={spaceId}
              activeChannelId={activeChannelId}
              isFriendsFeed={isFriendsFeed}
              onSelect={handleSelectChannel}
              onContextMenu={handleChannelContextMenu}
              dragHandle={ctx.handle}
              overlay={ctx.overlay}
            />
          )}
        />
      )}

      {!isFriendsFeed && (
        <>
          <CreateChannelModal
            open={!!createModal}
            onClose={() => setCreateModal(null)}
            spaceId={spaceId}
            defaultCategoryId={createModal?.categoryId ?? null}
          />
          <CategoryModal
            open={!!categoryModal}
            onClose={() => setCategoryModal(null)}
            spaceId={spaceId}
            categoryId={categoryModal?.categoryId}
          />
          <EditChannelModal
            open={!!editChannelId}
            onClose={() => setEditChannelId(null)}
            spaceId={spaceId}
            channelId={editChannelId}
          />
          {ctxMenu && (
            <ChannelContextMenu
              open
              onClose={() => setCtxMenu(null)}
              channelId={ctxMenu.channelId}
              position={{ x: ctxMenu.x, y: ctxMenu.y }}
              admin={
                isAdmin && ctxChannel
                  ? {
                      onEdit: () => setEditChannelId(ctxChannel.id),
                      onDelete:
                        nativeSpace && (ctxChannel.isDefault || ctxChannel.id === "chat")
                          ? undefined
                          : () => setDeleteChannelId(ctxChannel.id),
                      moveTargets: layoutManageable ? moveTargets : [],
                      currentCategoryId: ctxChannel.categoryId ?? null,
                      onMove: (categoryId) =>
                        runMove(moveChannel(ctxChannel.id, categoryId, Number.POSITIVE_INFINITY)),
                    }
                  : undefined
              }
            />
          )}
          {catMenu && catMenuNode && (
            <CategoryContextMenu
              position={{ x: catMenu.x, y: catMenu.y }}
              collapsed={collapsedCategories.has(catMenu.categoryId)}
              onToggleCollapsed={() => toggleCategory(catMenu.categoryId)}
              onNewChannel={isAdmin ? () => setCreateModal({ categoryId: catMenu.categoryId }) : undefined}
              onEdit={canArrange ? () => setCategoryModal({ categoryId: catMenu.categoryId }) : undefined}
              onDelete={canArrange ? () => setDeleteCategoryId(catMenu.categoryId) : undefined}
              onClose={() => setCatMenu(null)}
            />
          )}
          <ConfirmDialog
            open={!!deleteTarget}
            title={`Delete ${deleteTarget?.label ?? "channel"}?`}
            body="The channel is removed for everyone. Its messages stay on the relay but won't be shown here."
            confirmLabel="Delete channel"
            danger
            onConfirm={() => (deleteTarget ? deleteChannel(deleteTarget.id) : undefined)}
            onClose={() => setDeleteChannelId(null)}
          />
          <ConfirmDialog
            open={!!deleteCategory}
            title={`Delete "${deleteCategory?.category.name ?? ""}"?`}
            body={
              deleteCategory && deleteCategory.channels.length > 0
                ? `Its ${deleteCategory.channels.length} channel${deleteCategory.channels.length === 1 ? "" : "s"} will move out of the subfolder. No channels are deleted.`
                : "It has no channels."
            }
            confirmLabel="Delete subfolder"
            danger
            onConfirm={() => (deleteCategory ? applyOp(removeCategory(deleteCategory.category.id)) : undefined)}
            onClose={() => setDeleteCategoryId(null)}
          />
        </>
      )}
    </div>
  );
}

/** Collapsible subfolder header with aggregated unread (+ quick "new channel here" for admins) */
function CategoryHeader({
  name,
  spaceId,
  channels,
  isCollapsed,
  onToggle,
  onAdd,
  onContextMenu,
  dragHandle,
  dropTarget,
  overlay,
}: {
  name: string;
  spaceId: string;
  channels: SpaceChannel[];
  isCollapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  dragHandle?: DragHandle;
  dropTarget?: boolean;
  overlay?: boolean;
}) {
  return (
    <div
      ref={dragHandle?.ref}
      {...(dragHandle?.listeners ?? {})}
      onContextMenu={onContextMenu}
      className={cn(
        "group flex w-full items-center gap-1 px-2 pt-2.5 pb-0.5",
        overlay && "rounded-lg bg-surface shadow-lg",
        dropTarget && "text-heading",
      )}
    >
      <button
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        <ChevronRight
          size={10}
          className={cn(
            "shrink-0 text-muted transition-transform duration-150",
            !isCollapsed && "rotate-90",
          )}
        />
        <span className="label-caps truncate group-hover:text-heading transition-colors">
          {name}
        </span>
        {isCollapsed && (
          <CollapsedUnreadBadge spaceId={spaceId} channels={channels} />
        )}
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          className="shrink-0 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-heading transition-opacity"
          title={`Create channel in ${name}`}
          aria-label={`Create channel in ${name}`}
        >
          <Plus size={12} />
        </button>
      )}
    </div>
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
  dragHandle,
  overlay,
}: {
  ch: SpaceChannel;
  spaceId: string;
  activeChannelId: string | null;
  isFriendsFeed: boolean;
  onSelect: (channelId: string) => void;
  onContextMenu: (e: React.MouseEvent, channelId: string) => void;
  /** The whole row starts a drag (pointer only, after a short move — clicks still select). */
  dragHandle?: DragHandle;
  overlay?: boolean;
}) {
  const channelActiveId = `${spaceId}:${ch.id}`;
  // Only "active" while the space view is on screen: on Discover, Settings or a
  // profile the channel is remembered, not shown.
  const onSpaceView = useLocation().pathname === "/";
  const isActive = onSpaceView && channelActiveId === activeChannelId;
  const Icon = CHANNEL_ICONS[ch.type] ?? MessageSquare;
  const isVoice = ch.type === "voice" || ch.type === "video";

  return (
    <div
      ref={dragHandle?.ref}
      {...(dragHandle?.listeners ?? {})}
      className={cn(overlay && "rounded-xl bg-surface shadow-lg")}
    >
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
      {isVoice && !isFriendsFeed && !overlay && (
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
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150",
        isActive
          ? "bg-surface-hover text-heading"
          : hasUnread && !isMuted
            ? "text-heading font-medium hover:bg-surface"
            : "text-soft hover:bg-surface hover:text-heading",
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
