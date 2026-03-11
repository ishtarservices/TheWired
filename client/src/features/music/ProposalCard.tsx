import { Check, X, GitPullRequest } from "lucide-react";
import type { MusicProposal, ProposalChange } from "@/types/music";
import { useProfile } from "@/features/profile/useProfile";
import { Avatar } from "@/components/ui/Avatar";

function formatChange(change: ProposalChange): string {
  switch (change.type) {
    case "add_track":
      return `Add track${change.trackRef ? ` (${change.trackRef.split(":").pop()})` : ""}${change.position !== undefined ? ` at position ${change.position + 1}` : ""}`;
    case "remove_track":
      return `Remove track${change.trackRef ? ` (${change.trackRef.split(":").pop()})` : ""}`;
    case "reorder":
      return `Move track from position ${(change.from ?? 0) + 1} to ${(change.to ?? 0) + 1}`;
    case "update_metadata":
      return `Update ${change.field ?? "metadata"}${change.value ? ` to "${change.value}"` : ""}`;
    default:
      return "Unknown change";
  }
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-amber-500/20 text-amber-300",
  accepted: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
};

interface ProposalCardProps {
  proposal: MusicProposal;
  isOwner: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}

export function ProposalCard({ proposal, isOwner, onAccept, onReject }: ProposalCardProps) {
  const { profile } = useProfile(proposal.proposerPubkey);
  const proposerName = profile?.display_name || profile?.name || proposal.proposerPubkey.slice(0, 8) + "...";
  const date = new Date(proposal.createdAt * 1000);

  return (
    <div className="rounded-xl border border-edge card-glass p-4 transition-colors hover:border-edge-light">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitPullRequest size={16} className="shrink-0 text-pulse" />
          <h3 className="text-sm font-semibold text-heading">{proposal.title}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLES[proposal.status] ?? STATUS_STYLES.open}`}>
          {proposal.status}
        </span>
      </div>

      {proposal.description && (
        <p className="mb-3 text-xs text-soft">{proposal.description}</p>
      )}

      <div className="mb-3 space-y-1">
        {proposal.changes.map((change, i) => (
          <div key={i} className="flex items-center gap-2 rounded-lg bg-surface/50 px-2 py-1">
            <span className="h-1 w-1 shrink-0 rounded-full bg-pulse" />
            <span className="text-xs text-body">{formatChange(change)}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar src={profile?.picture} alt={proposerName} size="xs" />
          <span className="text-xs text-muted">
            {proposerName} &middot; {date.toLocaleDateString()}
          </span>
        </div>

        {isOwner && proposal.status === "open" && (
          <div className="flex gap-1.5">
            <button
              onClick={onAccept}
              className="flex items-center gap-1 rounded-lg bg-green-500/20 px-2.5 py-1 text-xs font-medium text-green-300 transition-colors hover:bg-green-500/30"
            >
              <Check size={12} />
              Accept
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1 rounded-lg bg-red-500/20 px-2.5 py-1 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/30"
            >
              <X size={12} />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
