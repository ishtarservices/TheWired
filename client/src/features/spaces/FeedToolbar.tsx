import { RefreshCw } from "lucide-react";

interface FeedToolbarProps {
  isRefreshing: boolean;
  onRefresh: () => void;
  children?: React.ReactNode;
}

export function FeedToolbar({ isRefreshing, onRefresh, children }: FeedToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.04] px-5 py-2.5">
      {children}
      <div className="flex-1" />
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
