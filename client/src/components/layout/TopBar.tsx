import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Wifi, WifiOff, Sun, Moon } from "lucide-react";
import { Button } from "../ui/Button";
import { useTheme } from "../../contexts/ThemeContext";
import { SearchInput } from "../../features/music/SearchInput";
import { useAppSelector } from "../../store/hooks";

interface TopBarProps {
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  channelName?: string;
  relayCount?: number;
  memberListVisible?: boolean;
  onToggleMemberList?: () => void;
  hasActiveSpace?: boolean;
}

export function TopBar({
  sidebarExpanded,
  onToggleSidebar,
  channelName,
  relayCount = 0,
  memberListVisible,
  onToggleMemberList,
  hasActiveSpace,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);

  return (
    <div className="flex h-12 items-center border-b border-edge glass px-3">
      <Button variant="ghost" size="sm" onClick={onToggleSidebar}>
        {sidebarExpanded ? (
          <PanelLeftClose size={18} />
        ) : (
          <PanelLeftOpen size={18} />
        )}
      </Button>
      <h2 className="ml-3 text-sm font-semibold text-heading">
        {channelName ?? "The Wired"}
      </h2>

      {sidebarMode === "music" && (
        <div className="ml-4">
          <SearchInput />
        </div>
      )}

      <div className="ml-auto flex items-center gap-3">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-md p-1.5 text-soft transition-colors hover:bg-card hover:text-heading"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* Relay indicator */}
        <div className="flex items-center gap-2 text-xs text-soft">
          {relayCount > 0 ? (
            <Wifi size={14} className="text-green-500 animate-pulse-glow" />
          ) : (
            <WifiOff size={14} className="text-red-500" />
          )}
          <span>
            {relayCount} relay{relayCount !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Right panel toggle */}
        {hasActiveSpace && onToggleMemberList && (
          <Button variant="ghost" size="sm" onClick={onToggleMemberList}>
            {memberListVisible ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
