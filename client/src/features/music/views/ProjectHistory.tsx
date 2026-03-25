import { useEffect, useState } from "react";
import { ArrowLeft, Clock, AlertCircle } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setMusicView, setActiveDetailId, setRevisions } from "@/store/slices/musicSlice";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { getApiBaseUrl } from "@/lib/api/client";
import { RevisionCard } from "../RevisionCard";
import type { MusicRevision } from "@/types/music";

export function ProjectHistory() {
  const dispatch = useAppDispatch();
  const addressableId = useAppSelector((s) => s.music.activeDetailId);
  const revisions = useAppSelector((s) =>
    addressableId ? s.music.revisions[addressableId] : undefined,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { scrollPaddingClass } = usePlaybackBarSpacing();

  // Derive display name from either a track or album
  const itemName = addressableId
    ? tracks[addressableId]?.title ?? albums[addressableId]?.title ?? addressableId
    : "";

  useEffect(() => {
    if (!addressableId) return;

    // Don't re-fetch if already loaded
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
        if (!res.ok) {
          throw new Error(`Failed to fetch revisions: ${res.statusText}`);
        }
        const json = await res.json();
        const data = json.data as MusicRevision[];
        dispatch(setRevisions({ addressableId, revisions: data }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        setLoading(false);
      }
    };

    fetchRevisions();
  }, [addressableId, dispatch, revisions]);

  const goBack = () => {
    if (!addressableId) {
      dispatch(setMusicView("home"));
      return;
    }
    // Navigate back to the item's detail view, preserving the activeDetailId
    if (addressableId.startsWith("33123:")) {
      dispatch(setActiveDetailId({ view: "album-detail", id: addressableId }));
    } else if (addressableId.startsWith("31683:")) {
      dispatch(setActiveDetailId({ view: "album-detail", id: addressableId }));
    } else {
      dispatch(setMusicView("home"));
    }
  };

  if (!addressableId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">No item selected</p>
      </div>
    );
  }

  return (
    <div className={`flex flex-1 flex-col overflow-y-auto ${scrollPaddingClass}`}>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <button
          onClick={goBack}
          className="rounded p-1 text-soft hover:text-heading transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <Clock size={18} className="text-muted" />
        <div>
          <h1 className="text-lg font-semibold text-heading">Project History</h1>
          <p className="text-xs text-soft">{itemName}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-6 py-6">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3">
            <AlertCircle size={16} className="text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}

        {!loading && !error && revisions && revisions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clock size={32} className="mb-3 text-muted" />
            <p className="text-sm text-soft">No revision history yet</p>
            <p className="mt-1 text-xs text-muted">
              Changes will be tracked when you edit this item
            </p>
          </div>
        )}

        {!loading && !error && revisions && revisions.length > 0 && (
          <div className="mx-auto max-w-lg">
            <p className="mb-4 text-xs text-muted">
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
        )}
      </div>
    </div>
  );
}
