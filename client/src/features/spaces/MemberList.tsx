import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Crown, MoreHorizontal } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useSpace } from "./useSpace";
import { MemberInput } from "./MemberInput";
import { useAppSelector } from "../../store/hooks";
import { usePermissions } from "./usePermissions";
import { MemberContextMenu } from "./moderation/MemberContextMenu";

function MemberItem({ pubkey, spaceId }: { pubkey: string; spaceId: string }) {
  const { profile } = useProfile(pubkey);
  const navigate = useNavigate();
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  const isAdmin = space?.adminPubkeys.includes(pubkey);
  const isSelf = pubkey === currentPubkey;
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="group relative flex w-full items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-white/[0.04]">
      <button
        onClick={() => navigate(`/profile/${pubkey}`)}
        className="flex flex-1 items-center gap-2 text-left min-w-0"
      >
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <span className="truncate text-sm text-body">{name}</span>
        {isAdmin && (
          <span title="Admin"><Crown size={12} className="shrink-0 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.5)]" /></span>
        )}
      </button>

      {!isSelf && (
        <button
          ref={btnRef}
          onClick={() => setMenuOpen(true)}
          className="rounded p-0.5 text-muted opacity-0 hover:bg-card/50 hover:text-heading transition-all group-hover:opacity-100"
        >
          <MoreHorizontal size={14} />
        </button>
      )}

      <MemberContextMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        pubkey={pubkey}
        spaceId={spaceId}
        anchorRef={btnRef}
      />
    </div>
  );
}

export function MemberList() {
  const { activeSpace, activeSpaceId, addMember, removeMember } = useSpace();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const { can } = usePermissions(activeSpaceId);

  if (!activeSpace || !activeSpaceId) return null;

  const members = activeSpace.memberPubkeys;
  const isAdmin = can("MANAGE_MEMBERS") || (!!currentPubkey && activeSpace.adminPubkeys.includes(currentPubkey));

  return (
    <div className="p-3 space-y-1">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        Members ({members.length})
      </div>
      {members.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted">
          No members loaded
        </div>
      ) : (
        members.map((pubkey) => (
          <MemberItem key={pubkey} pubkey={pubkey} spaceId={activeSpaceId} />
        ))
      )}

      {isAdmin && (
        <div className="mt-3 border-t border-white/[0.04] pt-3 px-1">
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
