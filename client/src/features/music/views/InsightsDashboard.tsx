import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, Play, Users, Music } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { InsightsChart } from "../InsightsChart";
import { getArtistSummary } from "@/lib/api/music";
import type { ArtistSummary, TrackInsights } from "@/types/music";

export function InsightsDashboard() {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const tracks = useAppSelector((s) => s.music.tracks);
  const [summary, setSummary] = useState<ArtistSummary | null>(null);
  const [selectedTrackInsights, setSelectedTrackInsights] = useState<TrackInsights | null>(null);
  const [selectedTrackTitle, setSelectedTrackTitle] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pubkey) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    getArtistSummary()
      .then((res) => {
        if (!cancelled) setSummary(res.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load insights");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [pubkey]);

  const handleTrackClick = async (addressableId: string, title: string) => {
    try {
      const { getTrackInsights } = await import("@/lib/api/music");
      const res = await getTrackInsights(addressableId);
      setSelectedTrackInsights(res.data);
      setSelectedTrackTitle(title);
    } catch {
      // silently fail
    }
  };

  if (!pubkey) {
    return (
      <div className="flex flex-1 items-center justify-center text-soft">
        <p>Sign in to view your insights.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-soft">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-pulse border-t-transparent" />
        <span className="ml-2">Loading insights...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-soft">
        <p>{error}</p>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      <h1 className="mb-6 text-xl font-semibold text-heading">Insights</h1>

      {/* Summary cards */}
      <div className="mb-8 grid grid-cols-3 gap-4">
        <SummaryCard
          icon={<Play size={18} />}
          label="Total Plays"
          value={formatNumber(summary.totalPlays)}
        />
        <SummaryCard
          icon={<Users size={18} />}
          label="Total Listeners"
          value={formatNumber(summary.totalListeners)}
        />
        <SummaryCard
          icon={<Music size={18} />}
          label="Tracks"
          value={String(summary.trackCount)}
        />
      </div>

      {/* Per-track chart section */}
      {selectedTrackInsights && selectedTrackTitle && (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-heading">
              Daily Plays -- {selectedTrackTitle}
            </h2>
            <div className="flex items-center gap-2">
              <TrendIndicator trend={selectedTrackInsights.trend} />
              <button
                onClick={() => {
                  setSelectedTrackInsights(null);
                  setSelectedTrackTitle(null);
                }}
                className="text-xs text-soft hover:text-heading"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-edge bg-panel p-4">
            <div className="mb-2 flex gap-4 text-xs text-soft">
              <span>{formatNumber(selectedTrackInsights.totalPlays)} plays</span>
              <span>{formatNumber(selectedTrackInsights.uniqueListeners)} unique listeners</span>
            </div>
            <InsightsChart data={selectedTrackInsights.dailyPlays} />
          </div>
        </div>
      )}

      {/* Track breakdown */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-heading">Track Breakdown</h2>
        {summary.trackBreakdown.length === 0 ? (
          <p className="text-sm text-soft">No tracks published yet.</p>
        ) : (
          <div className="rounded-lg border border-edge bg-panel">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-xs text-muted">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Track</th>
                  <th className="px-4 py-2 text-right font-medium">Plays</th>
                </tr>
              </thead>
              <tbody>
                {summary.trackBreakdown.map((item, idx) => {
                  const track = tracks[item.addressableId];
                  const displayTitle = track?.title ?? item.title ?? "Untitled";
                  return (
                    <tr
                      key={item.addressableId}
                      onClick={() => handleTrackClick(item.addressableId, displayTitle)}
                      className="cursor-pointer border-b border-edge/50 transition-colors last:border-0 hover:bg-surface"
                    >
                      <td className="px-4 py-2.5 text-muted">{idx + 1}</td>
                      <td className="px-4 py-2.5 text-body">{displayTitle}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-body">
                        {formatNumber(item.plays)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-edge bg-panel p-4">
      <div className="mb-2 flex items-center gap-2 text-soft">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums text-heading">{value}</div>
    </div>
  );
}

function TrendIndicator({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") {
    return (
      <span className="flex items-center gap-1 text-xs text-green-400">
        <TrendingUp size={14} /> Trending up
      </span>
    );
  }
  if (trend === "down") {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400">
        <TrendingDown size={14} /> Trending down
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-soft">
      <Minus size={14} /> Stable
    </span>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
