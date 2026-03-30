import { useState, useCallback } from "react";
import { Users, Settings, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { SearchPanel } from "../search/SearchPanel";
import { useSpace } from "./useSpace";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { toggleRightPanel } from "../../store/slices/uiSlice";
import { usePermissions } from "./usePermissions";
import { SpaceSettingsModal } from "./settings/SpaceSettingsModal";
import { parseChannelIdPart } from "./spaceSelectors";
import type { MessageSearchResult } from "../search/useMessageSearch";

export function ChannelHeader() {
  const { activeSpace, activeChannelId, resolveActiveChannel, getActiveChannelType, selectChannel } = useSpace();
  const dispatch = useAppDispatch();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const allChannels = useAppSelector((s) => s.spaces.channels);
  const { can } = usePermissions(activeSpace?.id ?? null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const spaceChannels = activeSpace ? allChannels[activeSpace.id] ?? [] : [];

  const handleJumpToMessage = useCallback(
    (result: MessageSearchResult) => {
      if (!result.eventId) return;

      const currentChannelPart = parseChannelIdPart(activeChannelId);

      // Switch channel if the result is in a different one
      if (result.channelId && result.channelId !== currentChannelPart) {
        selectChannel(result.channelId);
        // Wait for channel switch to render, then scroll
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToEventId(result.eventId!);
          });
        });
      } else {
        scrollToEventId(result.eventId);
      }
    },
    [activeChannelId, selectChannel],
  );

  if (!activeSpace || !activeChannelId) return null;

  const channel = resolveActiveChannel();
  const channelName = channel?.label ?? `#${getActiveChannelType()}`;
  const canManage = can("MANAGE_SPACE") || (!!currentPubkey && activeSpace.adminPubkeys.includes(currentPubkey));

  return (
    <div className="flex h-12 items-center border-b border-border px-5">
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
        {searchOpen ? (
          <SearchPanel
            mode="space"
            spaceId={activeSpace.id}
            channels={spaceChannels}
            onClose={() => setSearchOpen(false)}
            onJumpToMessage={handleJumpToMessage}
          />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSearchOpen(true)}
            title="Search messages"
          >
            <Search size={16} />
          </Button>
        )}
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
          onClick={() => dispatch(toggleRightPanel("space"))}
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

function scrollToEventId(eventId: string) {
  const el = document.querySelector(`[data-event-id="${eventId}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("animate-highlight-flash");
  setTimeout(() => el.classList.remove("animate-highlight-flash"), 1500);
}
