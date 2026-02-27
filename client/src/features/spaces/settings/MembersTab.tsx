import { useState } from "react";
import { Shield } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { useProfile } from "../../profile/useProfile";
import { useAppSelector } from "../../../store/hooks";
import { useRoles } from "../useRoles";
import { useMemberRoles } from "../useMemberRoles";

interface MembersTabProps {
  spaceId: string;
}

function MemberRow({
  pubkey,
  spaceId,
}: {
  pubkey: string;
  spaceId: string;
}) {
  const { profile } = useProfile(pubkey);
  const { roles } = useRoles(spaceId);
  const { assignRole } = useMemberRoles(spaceId);
  const [showRoles, setShowRoles] = useState(false);

  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white/[0.04] transition-colors">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm text-heading">{name}</div>
        <div className="truncate text-[10px] text-muted font-mono">{pubkey.slice(0, 16)}...</div>
      </div>

      <button
        onClick={() => setShowRoles(!showRoles)}
        className="rounded p-1 text-muted hover:bg-card/50 hover:text-heading transition-colors"
        title="Manage roles"
      >
        <Shield size={14} />
      </button>

      {showRoles && (
        <div className="absolute right-0 mt-1 w-48 rounded-lg glass-panel py-1 shadow-xl z-10">
          {roles.map((role) => (
            <button
              key={role.id}
              onClick={() => assignRole(pubkey, role.id)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-body hover:bg-card-hover/50"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: role.color ?? "#6b7280" }}
              />
              {role.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MembersTab({ spaceId }: MembersTabProps) {
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));
  const [filter, setFilter] = useState("");

  if (!space) return null;

  const members = space.memberPubkeys;
  const filtered = filter
    ? members.filter((pk) => pk.includes(filter.toLowerCase()))
    : members;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-heading">
        Members ({members.length})
      </h3>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter members..."
        className="w-full rounded-xl bg-white/[0.04] border border-white/[0.04] px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
      />

      <div className="space-y-0.5 max-h-96 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted">No members found</div>
        ) : (
          filtered.map((pubkey) => (
            <MemberRow key={pubkey} pubkey={pubkey} spaceId={spaceId} />
          ))
        )}
      </div>
    </div>
  );
}
