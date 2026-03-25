import { Shield, Lock, Globe, Calendar, Copy, Check } from "lucide-react";
import { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "../profile/useProfile";

export function SpaceInfoPanel() {
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const space = useAppSelector((s) =>
    s.spaces.list.find((sp) => sp.id === activeSpaceId),
  );

  if (!space) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-soft">No space selected</p>
      </div>
    );
  }

  const createdDate = new Date(space.createdAt * 1000);

  return (
    <div className="space-y-5 p-4">
      {/* Space header */}
      <div className="flex items-center gap-3">
        {space.picture ? (
          <img
            src={space.picture}
            alt={space.name}
            className="h-12 w-12 rounded-xl object-cover ring-1 ring-border"
          />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary-soft/10 ring-1 ring-border">
            <Globe size={20} className="text-soft" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-heading truncate">
            {space.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-0.5">
            {space.isPrivate ? (
              <Lock size={10} className="text-muted" />
            ) : (
              <Globe size={10} className="text-muted" />
            )}
            <span className="text-[10px] text-muted">
              {space.isPrivate ? "Private" : "Public"}
            </span>
            <span className="text-[10px] text-muted">
              {space.memberPubkeys.length} members
            </span>
          </div>
        </div>
      </div>

      {/* Description */}
      {space.about && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
            About
          </h4>
          <p className="text-xs text-soft leading-relaxed whitespace-pre-wrap">
            {space.about}
          </p>
        </div>
      )}

      {/* Created date */}
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <Calendar size={12} />
        <span>
          Created{" "}
          {createdDate.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>

      {/* Admins */}
      {space.adminPubkeys.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            <Shield size={10} className="inline mr-1" />
            Admins
          </h4>
          <div className="space-y-2">
            {space.adminPubkeys.slice(0, 8).map((pubkey) => (
              <AdminRow key={pubkey} pubkey={pubkey} />
            ))}
            {space.adminPubkeys.length > 8 && (
              <p className="text-[10px] text-muted">
                +{space.adminPubkeys.length - 8} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Space ID (copyable) */}
      <SpaceIdCopy spaceId={space.id} />
    </div>
  );
}

function AdminRow({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);

  return (
    <div className="flex items-center gap-2">
      <Avatar src={profile?.picture} size="xs" />
      <span className="text-xs text-body truncate">
        {profile?.display_name || profile?.name || pubkey.slice(0, 12) + "..."}
      </span>
    </div>
  );
}

function SpaceIdCopy({ spaceId }: { spaceId: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(spaceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex w-full items-center gap-2 rounded-lg bg-surface/50 px-3 py-2 text-left transition-colors hover:bg-surface"
    >
      <span className="flex-1 text-[10px] text-muted font-mono truncate">
        {spaceId}
      </span>
      {copied ? (
        <Check size={12} className="text-green-400 shrink-0" />
      ) : (
        <Copy size={12} className="text-muted shrink-0" />
      )}
    </button>
  );
}
