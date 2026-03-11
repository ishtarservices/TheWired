import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Music,
  Image,
  Eye,
  FileText,
  Plus,
  Minus,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import type { MusicRevision, RevisionChange } from "@/types/music";

function formatRelativeTime(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ChangeIcon({ type }: { type: RevisionChange["type"] }) {
  switch (type) {
    case "audio_replaced":
      return <RefreshCw size={12} className="text-blue-400" />;
    case "track_added":
      return <Plus size={12} className="text-green-400" />;
    case "track_removed":
      return <Minus size={12} className="text-red-400" />;
    case "track_reordered":
      return <ArrowUpDown size={12} className="text-amber-400" />;
    case "metadata_changed":
      return <FileText size={12} className="text-purple-400" />;
    case "cover_changed":
      return <Image size={12} className="text-pink-400" />;
    case "visibility_changed":
      return <Eye size={12} className="text-cyan-400" />;
    default:
      return <Music size={12} className="text-soft" />;
  }
}

function changeLabel(change: RevisionChange): string {
  switch (change.type) {
    case "audio_replaced":
      return "Audio file replaced";
    case "track_added":
      return `Track added${change.trackRef ? `: ${change.trackRef.split(":").pop()}` : ""}`;
    case "track_removed":
      return `Track removed${change.trackRef ? `: ${change.trackRef.split(":").pop()}` : ""}`;
    case "track_reordered":
      return "Tracks reordered";
    case "metadata_changed":
      if (change.field === "title") {
        return `Title: "${change.oldValue ?? ""}" -> "${change.newValue ?? ""}"`;
      }
      if (change.field === "artist") {
        return `Artist: "${change.oldValue ?? ""}" -> "${change.newValue ?? ""}"`;
      }
      if (change.field === "genre") {
        return `Genre: ${change.oldValue ?? "(none)"} -> ${change.newValue ?? "(none)"}`;
      }
      if (change.field === "license") {
        return `License changed`;
      }
      return `${change.field ?? "Field"} changed`;
    case "cover_changed":
      return "Cover art updated";
    case "visibility_changed":
      return `Visibility: ${change.oldValue ?? "public"} -> ${change.newValue ?? "public"}`;
    default:
      return "Unknown change";
  }
}

interface RevisionCardProps {
  revision: MusicRevision;
  isFirst: boolean;
  isLast: boolean;
}

export function RevisionCard({ revision, isFirst, isLast }: RevisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = revision.changes && revision.changes.length > 0;

  return (
    <div className="relative flex gap-3">
      {/* Timeline line and dot */}
      <div className="flex flex-col items-center">
        {/* Line above (hidden for first item) */}
        <div
          className={`w-px flex-none ${isFirst ? "bg-transparent" : "bg-edge"}`}
          style={{ height: 12 }}
        />
        {/* Dot */}
        <div
          className={`h-3 w-3 flex-none rounded-full border-2 ${
            isFirst
              ? "border-pulse bg-pulse/30"
              : "border-edge-light bg-card"
          }`}
        />
        {/* Line below (hidden for last item) */}
        <div
          className={`w-px flex-1 ${isLast ? "bg-transparent" : "bg-edge"}`}
        />
      </div>

      {/* Content */}
      <div className="flex-1 pb-5">
        <div className="rounded-xl border border-edge bg-card/50 p-3 transition-colors hover:border-edge-light">
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted">
                v{revision.version}
              </span>
              <span className="text-xs text-soft" title={formatDate(revision.createdAt)}>
                {formatRelativeTime(revision.createdAt)}
              </span>
            </div>
          </div>

          {/* Summary */}
          {revision.summary && (
            <p className="mt-1.5 text-sm text-body">{revision.summary}</p>
          )}
          {!revision.summary && isFirst && !hasChanges && (
            <p className="mt-1.5 text-sm text-soft italic">Initial version</p>
          )}

          {/* Expandable changes */}
          {hasChanges && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1 text-xs text-muted hover:text-soft transition-colors"
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {revision.changes.length} change{revision.changes.length !== 1 ? "s" : ""}
              </button>

              {expanded && (
                <div className="mt-2 space-y-1 rounded-lg bg-surface/50 p-2">
                  {revision.changes.map((change, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 flex-none">
                        <ChangeIcon type={change.type} />
                      </span>
                      <span className="text-soft">{changeLabel(change)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
