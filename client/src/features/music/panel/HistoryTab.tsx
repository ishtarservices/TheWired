import { useEffect, useState } from "react";
import { Clock, AlertCircle } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setRevisions } from "@/store/slices/musicSlice";
import { getApiBaseUrl } from "@/lib/api/client";
import { RevisionCard } from "../RevisionCard";
import type { MusicRevision } from "@/types/music";

interface HistoryTabProps {
  addressableId: string;
}

export function HistoryTab({ addressableId }: HistoryTabProps) {
  const dispatch = useAppDispatch();
  const revisions = useAppSelector(
    (s) => s.music.revisions[addressableId],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addressableId) return;
    if (revisions && revisions.length > 0) return;

    const fetchRevisions = async () => {
      setLoading(true);
      setError(null);
      try {
        const parts = addressableId.split(":");
        const kind = parts[0];
        const pubkey = parts[1];
        const slug = parts.slice(2).join(":");
        const res = await fetch(
          `${getApiBaseUrl()}/music/revisions/${kind}/${pubkey}/${encodeURIComponent(slug)}`,
        );
        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        const json = await res.json();
        dispatch(setRevisions({ addressableId, revisions: json.data as MusicRevision[] }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    };

    fetchRevisions();
  }, [addressableId, dispatch, revisions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-edge border-t-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-3 my-3 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5">
        <AlertCircle size={14} className="text-red-400" />
        <span className="text-xs text-red-400">{error}</span>
      </div>
    );
  }

  if (!revisions || revisions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Clock size={24} className="mb-2 text-muted/40" />
        <p className="text-xs text-muted">No revision history yet</p>
        <p className="mt-0.5 text-[10px] text-muted/60">
          Changes will be tracked when you edit this track
        </p>
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      <p className="mb-3 text-[10px] text-muted">
        {revisions.length} revision{revisions.length !== 1 ? "s" : ""}
      </p>
      {revisions.map((rev, i) => (
        <RevisionCard
          key={rev.version}
          revision={rev}
          isFirst={i === 0}
          isLast={i === revisions.length - 1}
        />
      ))}
    </div>
  );
}
