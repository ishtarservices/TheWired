import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Users, ArrowRight, Loader2, AlertCircle } from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { getInviteWithPreview, type InviteWithPreview } from "@/lib/api/invites";
import { useAppSelector } from "@/store/hooks";

interface InviteCardProps {
  code: string;
}

export function InviteCard({ code }: InviteCardProps) {
  const navigate = useNavigate();
  const spaces = useAppSelector((s) => s.spaces.list);

  const [invite, setInvite] = useState<InviteWithPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if already a member of this space
  const alreadyMember = invite ? spaces.some((s) => s.id === invite.spaceId) : false;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getInviteWithPreview(code)
      .then((res) => {
        if (!cancelled) setInvite(res.data);
      })
      .catch(() => {
        if (!cancelled) setError("Invite expired or invalid");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [code]);

  const handleClick = () => {
    if (alreadyMember && invite) {
      // Already a member — navigate to the space
      navigate("/");
    } else {
      // Open join flow — navigate to invite route which triggers JoinSpaceModal
      navigate(`/invite/${code}`);
    }
  };

  if (loading) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-border-light bg-surface/50 px-4 py-3 max-w-xs">
        <Loader2 size={16} className="animate-spin text-muted" />
        <span className="text-xs text-muted">Loading invite...</span>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="mt-1 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 max-w-xs">
        <AlertCircle size={14} className="text-red-400 shrink-0" />
        <span className="text-xs text-red-400">{error ?? "Invalid invite"}</span>
      </div>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="mt-1 flex w-full max-w-xs items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-left transition-all hover:bg-primary/10 hover:border-primary/30 group"
    >
      <Avatar
        src={invite.space.picture}
        alt={invite.space.name}
        size="md"
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-heading truncate">
          {invite.space.name}
        </p>
        {invite.space.about && (
          <p className="text-[11px] text-muted truncate mt-0.5">
            {invite.space.about}
          </p>
        )}
        <div className="mt-1 flex items-center gap-1.5 text-muted">
          <Users size={11} />
          <span className="text-[11px]">
            {invite.space.memberCount} member{invite.space.memberCount !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-center gap-1">
        <div className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          alreadyMember
            ? "bg-surface-hover text-muted"
            : "bg-primary/20 text-primary group-hover:bg-primary/30"
        }`}>
          {alreadyMember ? "Joined" : "Join"}
        </div>
        {!alreadyMember && (
          <ArrowRight size={12} className="text-primary/50 group-hover:text-primary transition-colors" />
        )}
      </div>
    </button>
  );
}
