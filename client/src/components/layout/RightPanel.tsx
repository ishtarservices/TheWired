import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import { MemberList } from "../../features/spaces/MemberList";
import { useResizeHandle } from "./useResizeHandle";

interface RightPanelProps {
  visible: boolean;
}

export function RightPanel({ visible }: RightPanelProps) {
  const { width, isDragging, onMouseDown, onDoubleClick } = useResizeHandle({
    side: "left",
  });

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col glass relative",
        !visible && "w-0 overflow-hidden",
        !isDragging && "transition-[width] duration-200",
      )}
      style={visible ? { width } : undefined}
    >
      {/* Resize handle — left edge */}
      {visible && (
        <div
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          className="group absolute left-0 top-0 bottom-0 z-20 w-1.5 cursor-col-resize"
        >
          {/* Decorative gradient edge */}
          <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-neon/10 via-edge to-pulse/20" />
          {/* Interactive highlight */}
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-0 transition-all duration-150",
              isDragging
                ? "w-[2px] bg-pulse/40"
                : "group-hover:w-[2px] group-hover:bg-pulse/20",
            )}
          />
        </div>
      )}

      <div className="flex h-14 items-center border-b border-white/[0.04] px-4">
        <Users size={16} className="mr-2 text-soft" />
        <span className="text-sm font-semibold text-body">Members</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <MemberList />
      </div>
    </div>
  );
}
