import clsx from "clsx";
import { Users } from "lucide-react";
import { MemberList } from "../../features/spaces/MemberList";

interface RightPanelProps {
  visible: boolean;
}

export function RightPanel({ visible }: RightPanelProps) {
  return (
    <div
      className={clsx(
        "flex flex-col border-l border-edge glass transition-all duration-200",
        visible ? "w-60" : "w-0 overflow-hidden",
      )}
    >
      <div className="flex h-12 items-center border-b border-edge px-4">
        <Users size={16} className="mr-2 text-soft" />
        <span className="text-sm font-semibold text-body">Members</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <MemberList />
      </div>
    </div>
  );
}
