import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  UserCheck,
  UserPlus,
  MessageCircle,
  Users,
  ArrowLeftRight,
} from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { Avatar } from "@/components/ui/Avatar";
import { useProfile } from "./useProfile";
import { useFollowData } from "./useFollowData";
import { useMutualFollow } from "./useMutualFollow";

export function ProfileSidePanel() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const match = pathname.match(/^\/profile\/([0-9a-f]+)$/);
  const pubkey = match ? match[1] : null;

  useProfile(pubkey); // warm cache for sub-components
  const myFollowList = useAppSelector((s) => s.identity.followList);
  const spaces = useAppSelector((s) => s.spaces.list);

  // Get the target user's following list
  const { following } = useFollowData(pubkey ?? "");
  const mutual = useMutualFollow(pubkey ?? "");

  // Compute mutual follows
  const mutualFollows = useMemo(() => {
    if (!following.length || !myFollowList.length) return [];
    const mySet = new Set(myFollowList);
    return following.filter((pk) => mySet.has(pk) && pk !== pubkey);
  }, [following, myFollowList, pubkey]);

  // Compute shared spaces
  const sharedSpaces = useMemo(() => {
    if (!pubkey) return [];
    return spaces.filter((sp) => sp.memberPubkeys.includes(pubkey));
  }, [pubkey, spaces]);

  if (!pubkey) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-soft">No profile selected</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4">
      {/* Follow relationship */}
      <div className="rounded-xl bg-surface/50 p-3">
        <div className="flex items-center gap-2 text-xs">
          <ArrowLeftRight size={14} className="text-muted" />
          <span className="text-soft">
            {mutual.iFollow && mutual.theyFollowMe
              ? "You follow each other"
              : mutual.iFollow
                ? "You follow them"
                : mutual.theyFollowMe
                  ? "They follow you"
                  : "No follow relationship"}
          </span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2">
        <button
          onClick={() => navigate(`/dm/${pubkey}`)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface py-2 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <MessageCircle size={13} />
          Message
        </button>
        <button className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-surface py-2 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading">
          {mutual.iFollow ? (
            <>
              <UserCheck size={13} />
              Following
            </>
          ) : (
            <>
              <UserPlus size={13} />
              Follow
            </>
          )}
        </button>
      </div>

      {/* Mutual follows */}
      {mutualFollows.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            <Users size={10} className="inline mr-1" />
            {mutualFollows.length} Mutual Follow
            {mutualFollows.length !== 1 ? "s" : ""}
          </h4>
          <div className="space-y-2">
            {mutualFollows.slice(0, 10).map((pk) => (
              <MutualFollowRow key={pk} pubkey={pk} />
            ))}
            {mutualFollows.length > 10 && (
              <p className="text-[10px] text-muted">
                +{mutualFollows.length - 10} more
              </p>
            )}
          </div>
        </div>
      )}

      {/* Shared spaces */}
      {sharedSpaces.length > 0 && (
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">
            Shared Spaces
          </h4>
          <div className="space-y-1.5">
            {sharedSpaces.map((sp) => (
              <div
                key={sp.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-soft"
              >
                {sp.picture ? (
                  <img
                    src={sp.picture}
                    alt=""
                    className="h-5 w-5 rounded object-cover"
                  />
                ) : (
                  <div className="h-5 w-5 rounded bg-surface" />
                )}
                <span className="truncate">{sp.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MutualFollowRow({ pubkey }: { pubkey: string }) {
  const { profile } = useProfile(pubkey);
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/profile/${pubkey}`)}
      className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface"
    >
      <Avatar src={profile?.picture} size="xs" />
      <span className="text-xs text-body truncate">
        {profile?.display_name || profile?.name || pubkey.slice(0, 12) + "..."}
      </span>
    </button>
  );
}
