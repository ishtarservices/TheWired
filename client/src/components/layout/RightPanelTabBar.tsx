import { cn } from "@/lib/utils";
import type { PanelTab } from "./useRightPanelContext";

interface RightPanelTabBarProps {
  tabs: PanelTab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function RightPanelTabBar({
  tabs,
  activeTab,
  onTabChange,
}: RightPanelTabBarProps) {
  if (tabs.length <= 1) return null;

  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
            activeTab === tab.id
              ? "bg-surface text-heading"
              : "text-muted hover:text-soft",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
