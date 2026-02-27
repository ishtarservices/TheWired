import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sun, Moon } from "lucide-react";
import { Button } from "../ui/Button";
import { useTheme } from "../../contexts/ThemeContext";
import { SearchInput } from "../../features/music/SearchInput";
import { UserSearchInput } from "../../features/search/UserSearchInput";
import { useAppSelector } from "../../store/hooks";

interface TopBarProps {
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  channelName?: string;
  memberListVisible?: boolean;
  onToggleMemberList?: () => void;
  hasActiveSpace?: boolean;
}

export function TopBar({
  sidebarExpanded,
  onToggleSidebar,
  channelName,
  memberListVisible,
  onToggleMemberList,
  hasActiveSpace,
}: TopBarProps) {
  const { theme, toggleTheme } = useTheme();
  const sidebarMode = useAppSelector((s) => s.ui.sidebarMode);

  return (
    <div className="relative z-10 flex h-14 items-center border-b border-white/[0.04] glass px-3">
      <Button variant="ghost" size="sm" onClick={onToggleSidebar}>
        {sidebarExpanded ? (
          <PanelLeftClose size={18} />
        ) : (
          <PanelLeftOpen size={18} />
        )}
      </Button>
      <h2 className="ml-3 text-sm font-semibold tracking-wide text-heading">
        {channelName ?? "The Wired"}
      </h2>

      <div className="ml-auto flex items-center gap-3">
        {/* Mode-aware search */}
        {sidebarMode === "music" ? <SearchInput /> : <UserSearchInput />}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-xl p-2 text-soft transition-colors hover:bg-white/[0.04] hover:text-heading"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

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
