import { useProfile } from "@/features/profile/useProfile";
import type { ShelfAttribution as Attribution } from "./shelf";

function relative(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

function PosterName({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || `${pubkey.slice(0, 8)}…`;
  return <span className="font-medium text-soft">{name}</span>;
}

interface ShelfAttributionProps {
  postedBy: Attribution[];
  className?: string;
}

/**
 * "Posted by X · 2h ago — note" under a shelf card. Shows the latest post;
 * earlier posters are summarised ("+2 more").
 */
export function ShelfAttributionLine({ postedBy, className = "" }: ShelfAttributionProps) {
  if (postedBy.length === 0) return null;
  const latest = postedBy[postedBy.length - 1];
  const others = postedBy.length - 1;
  return (
    <div className={`mt-1 min-w-0 text-[11px] leading-snug text-muted ${className}`}>
      <p className="truncate">
        Posted by <PosterName pubkey={latest.pubkey} />
        {others > 0 && <span> +{others} more</span>}
        <span> · {relative(latest.at)}</span>
      </p>
      {latest.note && (
        <p className="mt-0.5 line-clamp-2 text-soft" title={latest.note}>
          {latest.note}
        </p>
      )}
    </div>
  );
}
