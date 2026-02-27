import { useState } from "react";
import { Users, Settings } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { useSpace } from "./useSpace";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { toggleMemberList } from "../../store/slices/uiSlice";
import { usePermissions } from "./usePermissions";
import { SpaceSettingsModal } from "./settings/SpaceSettingsModal";

export function ChannelHeader() {
  const { activeSpace, activeChannelId, resolveActiveChannel, getActiveChannelType } = useSpace();
  const dispatch = useAppDispatch();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const { can } = usePermissions(activeSpace?.id ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!activeSpace || !activeChannelId) return null;

  const channel = resolveActiveChannel();
  const channelName = channel?.label ?? `#${getActiveChannelType()}`;
  const canManage = can("MANAGE_SPACE") || (!!currentPubkey && activeSpace.adminPubkeys.includes(currentPubkey));

  return (
    <div className="flex h-12 items-center border-b border-white/[0.04] px-5">
      <span className="text-sm font-semibold tracking-wide text-heading">
        {channelName}
      </span>
      <span className="ml-2 text-xs text-muted">
        in {activeSpace.name}
      </span>
      {channel && channel.slowModeSeconds > 0 && (
        <span className="ml-2 rounded bg-card px-1.5 py-0.5 text-[10px] text-muted">
          Slow mode: {channel.slowModeSeconds}s
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            title="Space settings"
          >
            <Settings size={16} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch(toggleMemberList())}
        >
          <Users size={16} />
        </Button>
      </div>

      {activeSpace && (
        <SpaceSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          spaceId={activeSpace.id}
        />
      )}
    </div>
  );
}
