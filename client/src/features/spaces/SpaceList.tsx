import { useState, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Plus, Eye, Users, BellOff } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { useSpace } from "./useSpace";
import { SpaceActionModal } from "./SpaceActionModal";
import { SpaceContextMenu } from "./SpaceContextMenu";
import { useAppSelector } from "../../store/hooks";

export function SpaceList() {
  const { spaces, activeSpaceId, selectSpace } = useSpace();
  const [showAction, setShowAction] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{ spaceId: string; x: number; y: number } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSelectSpace = (spaceId: string) => {
    selectSpace(spaceId);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, spaceId: string) => {
    e.preventDefault();
    setCtxMenu({ spaceId, x: e.clientX, y: e.clientY });
  }, []);

  const spaceUnread = useAppSelector((s) => s.notifications.spaceUnread);
  const spaceMentions = useAppSelector((s) => s.notifications.spaceMentions);
  const spaceMutes = useAppSelector((s) => s.notifications.spaceMutes);

  return (
    <>
      <div className="p-3 space-y-1.5">
        {spaces.length === 0 && (
          <div className="p-2 text-center text-xs text-muted">
            No spaces yet
          </div>
        )}
        {spaces.map((space) => {
          const mentions = spaceMentions[space.id] ?? 0;
          const unread = spaceUnread[space.id] ?? 0;
          const hasUnread = mentions > 0 || unread > 0;
          const isMuted = spaceMutes[space.id]?.muted &&
            (!spaceMutes[space.id]?.muteUntil || spaceMutes[space.id].muteUntil! > Date.now());

          return (
            <button
              key={space.id}
              onClick={() => handleSelectSpace(space.id)}
              onContextMenu={(e) => handleContextMenu(e, space.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                space.id === activeSpaceId
                  ? "bg-pulse/8 text-heading"
                  : "text-soft hover:bg-white/[0.04] hover:text-heading",
              )}
            >
              <Avatar src={space.picture} alt={space.name} size="sm" />
              <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>
              {isMuted && (
                <BellOff size={11} className="shrink-0 text-muted" />
              )}
              {hasUnread ? (
                <span
                  className={cn(
                    "flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white",
                    mentions > 0 ? "bg-pulse" : "bg-white/20",
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
        })}

        {/* Create / Join button */}
        <button
          onClick={() => setShowAction(true)}
          className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.04] px-3 py-2 text-xs text-muted transition-all duration-150 hover:border-pulse/40 hover:text-pulse hover:bg-pulse/5"
        >
          <Plus size={14} />
          <span>New Space</span>
        </button>
      </div>

      <SpaceActionModal
        open={showAction}
        onClose={() => setShowAction(false)}
      />

      {ctxMenu && (
        <SpaceContextMenu
          open
          onClose={() => setCtxMenu(null)}
          spaceId={ctxMenu.spaceId}
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
        />
      )}
    </>
  );
}
