import { RefreshCw } from "lucide-react";

interface FeedToolbarProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
  /** Actions shown on the right, immediately before the Refresh button. */
  rightSlot?: React.ReactNode;
}

export function FeedToolbar({ isRefreshing, onRefresh, children, rightSlot }: FeedToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      {children}
      <div className="flex-1" />
      {rightSlot}
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-soft transition-all duration-150 hover:bg-card hover:text-heading disabled:opacity-50"
        title="Refresh feed"
      >
        <RefreshCw
          size={13}
          className={isRefreshing ? "animate-spin" : ""}
        />
        {isRefreshing ? "Refreshing..." : "Refresh"}
      </button>
    </div>
  );
}
