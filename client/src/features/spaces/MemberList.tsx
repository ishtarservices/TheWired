import { useNavigate } from "react-router-dom";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useSpace } from "./useSpace";
import { MemberInput } from "./MemberInput";
import { useAppSelector } from "../../store/hooks";

function MemberItem({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  const navigate = useNavigate();
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <button
      onClick={() => navigate(`/profile/${pubkey}`)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-card/30"
    >
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <span className="truncate text-sm text-body">{name}</span>
    </button>
  );
}

export function MemberList() {
  const { activeSpace, activeSpaceId, addMember, removeMember } = useSpace();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);

  if (!activeSpace || !activeSpaceId) return null;

  const members = activeSpace.memberPubkeys;
  const isAdmin = !!currentPubkey && activeSpace.adminPubkeys.includes(currentPubkey);

  return (
    <div className="space-y-0.5 p-2">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Members ({members.length})
      </div>
      {members.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted">
          No members loaded
        </div>
      ) : (
        members.map((pubkey) => <MemberItem key={pubkey} pubkey={pubkey} />)
      )}

      {isAdmin && (
        <div className="mt-3 border-t border-edge pt-3 px-1">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Add Member
          </div>
          <MemberInput
            members={members}
            onAdd={(pubkey) => addMember(activeSpaceId, pubkey)}
            onRemove={(pubkey) => removeMember(activeSpaceId, pubkey)}
          />
        </div>
      )}
    </div>
  );
}
