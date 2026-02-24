import { Users } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useSpace } from "./useSpace";
import { useAppDispatch } from "../../store/hooks";
import { toggleMemberList } from "../../store/slices/uiSlice";

export function ChannelHeader() {
  const { activeSpace, activeChannelId } = useSpace();
  const dispatch = useAppDispatch();

  if (!activeSpace || !activeChannelId) return null;

  const channelType = activeChannelId.split(":").pop() ?? "";
  const channelName = `#${channelType}`;

  return (
    <div className="flex h-12 items-center border-b border-edge px-4">
      <span className="text-sm font-semibold text-heading">
        {channelName}
      </span>
      <span className="ml-2 text-xs text-muted">
        in {activeSpace.name}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={() => dispatch(toggleMemberList())}
      >
        <Users size={16} />
      </Button>
    </div>
  );
}
