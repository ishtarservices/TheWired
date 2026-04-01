import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Plus, Eye, Users, BellOff, Search, X, Star, Compass } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { useSpace } from "./useSpace";
import { SpaceActionModal } from "./SpaceActionModal";
import { SpaceContextMenu } from "./SpaceContextMenu";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setPinnedSpaceIds } from "../../store/slices/uiSlice";
import { getUserState } from "../../lib/db/userStateStore";
import { FRIENDS_FEED_ID } from "../friends/friendsFeedConstants";

export function SpaceList() {
  const { spaces, activeSpaceId, selectSpace } = useSpace();
  const [showAction, setShowAction] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ spaceId: string; x: number; y: number } | null>(null);
  const [ctxSpaceId, setCtxSpaceId] = useState<string>("");
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();

  const pinnedSpaceIds = useAppSelector((s) => s.ui.pinnedSpaceIds);
  const spaceUnread = useAppSelector((s) => s.notifications.spaceUnread);
  const spaceMentions = useAppSelector((s) => s.notifications.spaceMentions);
  const spaceMutes = useAppSelector((s) => s.notifications.spaceMutes);

  // Restore pinned spaces from IndexedDB on mount
  useEffect(() => {
    getUserState<string[]>("pinnedSpaceIds").then((ids) => {
      if (ids && ids.length > 0) {
        dispatch(setPinnedSpaceIds(ids));
      }
    });
  }, [dispatch]);

  const handleSelectSpace = (spaceId: string) => {
    selectSpace(spaceId);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const handleSelectFriendsFeed = () => {
    selectSpace(FRIENDS_FEED_ID);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, spaceId: string) => {
    e.preventDefault();
    setCtxSpaceId(spaceId);
    setCtxMenu({ spaceId, x: e.clientX, y: e.clientY });
  }, []);

  // Split spaces into pinned (favorites) and unpinned, applying filter
  const { favoriteSpaces, otherSpaces } = useMemo(() => {
    const pinnedSet = new Set(pinnedSpaceIds);
    const q = filter.toLowerCase();

    const filtered = q
      ? spaces.filter((s) => s.name.toLowerCase().includes(q))
      : spaces;

    const favorites = filtered.filter((s) => pinnedSet.has(s.id));
    const others = filtered.filter((s) => !pinnedSet.has(s.id));

    return { favoriteSpaces: favorites, otherSpaces: others };
  }, [spaces, pinnedSpaceIds, filter]);

  const showFilter = spaces.length >= 6;
  const isFriendsFeedActive = activeSpaceId === FRIENDS_FEED_ID;

  return (
    <>
      <div className="p-3 space-y-1.5">
        {/* Quick filter */}
        {showFilter && (
          <div className="flex items-center gap-1.5 rounded-lg bg-field ring-1 ring-border px-2 py-1 transition-all focus-within:ring-primary/30 mb-1">
            <Search size={11} className="text-muted shrink-0" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter spaces…"
              className="w-full bg-transparent text-xs text-heading placeholder-muted outline-none"
            />
            {filter && (
              <button
                onClick={() => setFilter("")}
                className="text-muted hover:text-heading"
              >
                <X size={10} />
              </button>
            )}
          </div>
        )}

        {/* Friends Feed — always visible at top (unless filtered out) */}
        {!filter && (
          <button
            onClick={handleSelectFriendsFeed}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
              isFriendsFeedActive
                ? "bg-primary/8 text-heading"
                : "text-soft hover:bg-surface-hover hover:text-heading",
            )}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 shrink-0">
              <Users size={14} className="text-primary" />
            </div>
            <span className="truncate text-left">Friends Feed</span>
          </button>
        )}

        {/* Discover — always visible below Friends Feed (unless filtering) */}
        {!filter && (
          <button
            onClick={() => navigate("/discover")}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
              location.pathname === "/discover"
                ? "bg-primary/8 text-heading"
                : "text-soft hover:bg-surface-hover hover:text-heading",
            )}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 shrink-0">
              <Compass size={14} className="text-primary" />
            </div>
            <span className="truncate text-left">Discover</span>
          </button>
        )}

        {/* Favorites section */}
        {favoriteSpaces.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">
              <Star size={10} className="text-primary/60" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
                Favorites
              </span>
            </div>
            {favoriteSpaces.map((space) => (
              <SpaceButton
                key={space.id}
                space={space}
                isActive={space.id === activeSpaceId}
                mentions={spaceMentions[space.id] ?? 0}
                unread={spaceUnread[space.id] ?? 0}
                isMuted={
                  spaceMutes[space.id]?.muted &&
                  (!spaceMutes[space.id]?.muteUntil || spaceMutes[space.id].muteUntil! > Date.now())
                }
                onClick={() => handleSelectSpace(space.id)}
                onContextMenu={(e) => handleContextMenu(e, space.id)}
              />
            ))}
          </>
        )}

        {/* All Spaces section */}
        {(favoriteSpaces.length > 0 || filter) && otherSpaces.length > 0 && (
          <div className="px-2 pt-2 pb-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">
              {filter ? "Results" : "All Spaces"}
            </span>
          </div>
        )}

        {spaces.length === 0 && !filter && (
          <div className="p-2 text-center text-xs text-muted">
            No spaces yet
          </div>
        )}

        {filter && favoriteSpaces.length === 0 && otherSpaces.length === 0 && (
          <div className="p-2 text-center text-xs text-muted">
            No matching spaces
          </div>
        )}

        {otherSpaces.map((space) => (
          <SpaceButton
            key={space.id}
            space={space}
            isActive={space.id === activeSpaceId}
            mentions={spaceMentions[space.id] ?? 0}
            unread={spaceUnread[space.id] ?? 0}
            isMuted={
              spaceMutes[space.id]?.muted &&
              (!spaceMutes[space.id]?.muteUntil || spaceMutes[space.id].muteUntil! > Date.now())
            }
            onClick={() => handleSelectSpace(space.id)}
            onContextMenu={(e) => handleContextMenu(e, space.id)}
          />
        ))}

        {/* Create / Join button */}
        <button
          onClick={() => setShowAction(true)}
          className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted transition-all duration-150 hover:border-primary/40 hover:text-primary hover:bg-primary/5"
        >
          <Plus size={14} />
          <span>New Space</span>
        </button>
      </div>

      <SpaceActionModal
        open={showAction}
        onClose={() => setShowAction(false)}
      />

      {ctxSpaceId && (
        <SpaceContextMenu
          open={!!ctxMenu}
          onClose={() => setCtxMenu(null)}
          spaceId={ctxSpaceId}
          position={ctxMenu ? { x: ctxMenu.x, y: ctxMenu.y } : { x: 0, y: 0 }}
        />
      )}
    </>
  );
}

/** Individual space button extracted for reuse */
function SpaceButton({
  space,
  isActive,
  mentions,
  unread,
  isMuted,
  onClick,
  onContextMenu,
}: {
  space: { id: string; name: string; picture?: string; mode: string };
  isActive: boolean;
  mentions: number;
  unread: number;
  isMuted: boolean | undefined;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const hasUnread = mentions > 0 || unread > 0;

  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
        isActive
          ? "bg-primary/8 text-heading"
          : "text-soft hover:bg-surface-hover hover:text-heading",
      )}
    >
      <div className="relative shrink-0">
        <Avatar src={space.picture} alt={space.name} size="sm" />
        {mentions > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-surface animate-pulse" />
        )}
      </div>
      <span className={cn(
        "min-w-0 flex-1 truncate text-left",
        hasUnread && !isMuted && "font-semibold",
      )}>{space.name}</span>
      {isMuted && (
        <BellOff size={11} className="shrink-0 text-muted" />
      )}
      {hasUnread ? (
        <span
          className={cn(
            "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
            mentions > 0 ? "bg-primary" : "bg-surface-hover",
          )}
        >
          {mentions > 0 ? mentions : unread}
        </span>
      ) : !isMuted && (
        space.mode === "read" ? (
          <Eye size={12} className="shrink-0 text-muted" />
        ) : (
          <Users size={12} className="shrink-0 text-muted" />
        )
      )}
    </button>
  );
}
