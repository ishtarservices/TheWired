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
  const [ctxSpaceId, setCtxSpaceId] = useState<string>("");
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
    setCtxSpaceId(spaceId);
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
        })}

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
