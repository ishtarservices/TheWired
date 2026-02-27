import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Plus, Eye, Users } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { useSpace } from "./useSpace";
import { CreateSpaceModal } from "./CreateSpaceModal";

export function SpaceList() {
  const { spaces, activeSpaceId, selectSpace, createSpace } = useSpace();
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSelectSpace = (spaceId: string) => {
    selectSpace(spaceId);
    if (location.pathname !== "/") {
      navigate("/");
    }
  };

  return (
    <>
      <div className="p-3 space-y-1.5">
        {spaces.length === 0 && (
          <div className="p-2 text-center text-xs text-muted">
            No spaces yet
          </div>
        )}
        {spaces.map((space) => (
          <button
            key={space.id}
            onClick={() => handleSelectSpace(space.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all duration-150",
              space.id === activeSpaceId
                ? "bg-pulse/8 text-heading"
                : "text-soft hover:bg-white/[0.04] hover:text-heading",
            )}
          >
            <Avatar src={space.picture} alt={space.name} size="sm" />
            <span className="min-w-0 flex-1 truncate text-left">{space.name}</span>
            {space.mode === "read" ? (
              <Eye size={12} className="shrink-0 text-muted" />
            ) : (
              <Users size={12} className="shrink-0 text-muted" />
            )}
          </button>
        ))}

        {/* Create button */}
        <button
          onClick={() => setShowCreate(true)}
          className="flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.04] px-3 py-2 text-xs text-muted transition-all duration-150 hover:border-pulse/40 hover:text-pulse hover:bg-pulse/5"
        >
          <Plus size={14} />
          <span>New Space</span>
        </button>
      </div>

      <CreateSpaceModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={createSpace}
      />
    </>
  );
}
