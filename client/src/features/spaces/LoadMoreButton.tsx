import { Loader2 } from "lucide-react";

interface LoadMoreButtonProps {
  isLoading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

export function LoadMoreButton({ isLoading, hasMore, onLoadMore }: LoadMoreButtonProps) {
  if (!hasMore) {
    return (
      <div className="py-6 text-center text-xs text-faint">
        No more to load
      </div>
    );
  }

  return (
    <div className="flex justify-center py-4">
      <button
        onClick={onLoadMore}
        disabled={isLoading}
        className="flex items-center gap-2 rounded-xl bg-white/[0.04] border border-white/[0.04] px-4 py-2 text-xs font-medium text-body transition-all duration-150 hover:bg-white/[0.05] hover:text-heading disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            Loading...
          </>
        ) : (
          "Load more"
        )}
      </button>
    </div>
  );
}
