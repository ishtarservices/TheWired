import { useState, useRef, useCallback, useMemo, memo } from "react";
import { MoreHorizontal, Link2, Search, X, Plus, ChevronDown, ChevronRight, Rss } from "lucide-react";
import { Avatar } from "../../components/ui/Avatar";
import { useProfile } from "../profile/useProfile";
import { useUserPopover } from "../profile/UserPopoverContext";
import { useSpace } from "./useSpace";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { usePermissions } from "./usePermissions";
import { useRoles } from "./useRoles";
import { useMemberRoles } from "./useMemberRoles";
import { selectActiveSpace } from "./spaceSelectors";
import { MemberContextMenu } from "./moderation/MemberContextMenu";
import { InviteGenerateModal } from "./InviteGenerateModal";
import { useUserSearch } from "../search/useUserSearch";
import { addFeedSources, removeFeedSource as removeFeedSourceApi } from "../../lib/api/spaces";
import { updateSpaceFeedSources } from "../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../lib/db/spaceStore";
import { switchSpaceChannel } from "../../lib/nostr/groupSubscriptions";
import type { Space } from "../../types/space";

interface RoleGroup {
  roleId: string;
  label: string;
  color?: string;
  position: number;
  pubkeys: string[];
}

/** Build Discord-style role groups from member data */
function useRoleGroups(spaceId: string | null, allPubkeys: string[]) {
  const { roles } = useRoles(spaceId ?? "");
  const { members: memberData } = useMemberRoles(spaceId);

  return useMemo(() => {
    const memberRolesMap = new Map(memberData.map((m) => [m.pubkey, m.roles]));

    // Find the default role for the fallback group label
    const defaultRole = roles.find((r) => r.isDefault);

    const groupMap = new Map<string, RoleGroup>();

    for (const pubkey of allPubkeys) {
      const mRoles = memberRolesMap.get(pubkey) ?? [];
      // Highest role = lowest position
      const topRole = mRoles.length > 0
        ? [...mRoles].sort((a, b) => a.position - b.position)[0]
        : undefined;

      const groupKey = topRole?.id ?? "__default__";

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          roleId: groupKey,
          label: topRole?.name ?? defaultRole?.name ?? "Members",
          color: topRole?.color,
          position: topRole?.position ?? 999,
          pubkeys: [],
        });
      }
      groupMap.get(groupKey)!.pubkeys.push(pubkey);
    }

    return [...groupMap.values()].sort((a, b) => a.position - b.position);
  }, [allPubkeys, memberData, roles]);
}

const MemberItem = memo(function MemberItem({
  pubkey,
  spaceId,
  roleColor,
}: {
  pubkey: string;
  spaceId: string;
  roleColor?: string;
}) {
  const { profile } = useProfile(pubkey);
  const { openUserPopover } = useUserPopover();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const isSelf = pubkey === currentPubkey;
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);

  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="group relative flex w-full items-center gap-2 rounded-xl px-3 py-1.5 transition-colors hover:bg-surface-hover">
      <button
        ref={avatarRef}
        onClick={() => {
          if (avatarRef.current) openUserPopover(pubkey, avatarRef.current);
        }}
        className="flex flex-1 items-center gap-2 text-left min-w-0"
      >
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <span
          className="truncate text-sm"
          style={roleColor ? { color: roleColor } : undefined}
        >
          {name}
        </span>
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
});

const FeedSourceItem = memo(function FeedSourceItem({
  pubkey,
  canManage,
  onRemove,
}: {
  pubkey: string;
  canManage: boolean;
  onRemove: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const { openUserPopover } = useUserPopover();
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  const avatarRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="group relative flex w-full items-center gap-2 rounded-xl px-3 py-2 transition-colors hover:bg-surface-hover">
      <button
        ref={avatarRef}
        onClick={() => {
          if (avatarRef.current) openUserPopover(pubkey, avatarRef.current);
        }}
        className="flex flex-1 items-center gap-2 text-left min-w-0"
      >
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <span className="truncate text-sm text-body">{name}</span>
        <Rss size={11} className="shrink-0 text-primary/60" />
      </button>

      {canManage && (
        <button
          onClick={onRemove}
          className="rounded p-0.5 text-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 transition-all group-hover:opacity-100"
          title="Remove from feed"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
});

function FeedSourceSearch({
  spaceId,
  existingPubkeys,
  activeChannelType,
  activeChannelIdPart,
}: {
  spaceId: string;
  existingPubkeys: string[];
  activeChannelType: string;
  activeChannelIdPart?: string;
}) {
  const dispatch = useAppDispatch();
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));
  const { query, setQuery, results, isSearching } = useUserSearch();

  const handleAdd = useCallback(
    async (pubkey: string) => {
      if (!space) return;

      // Optimistic update
      const updatedPubkeys = [...space.feedPubkeys, pubkey];
      dispatch(updateSpaceFeedSources({ spaceId, pubkeys: updatedPubkeys }));
      const updatedSpace: Space = { ...space, feedPubkeys: updatedPubkeys };
      updateSpaceInStore(updatedSpace);

      // Re-subscribe the active channel with updated feed sources
      if (activeChannelType) {
        switchSpaceChannel(updatedSpace, activeChannelType, activeChannelIdPart);
      }

      setQuery("");

      // Persist to backend
      addFeedSources(spaceId, [pubkey]).catch((err) => {
        console.error("[FeedSources] Failed to add:", err);
        // Rollback
        dispatch(updateSpaceFeedSources({ spaceId, pubkeys: space.feedPubkeys }));
        updateSpaceInStore(space);
        // Re-subscribe with original
        if (activeChannelType) {
          switchSpaceChannel(space, activeChannelType, activeChannelIdPart);
        }
      });
    },
    [dispatch, space, spaceId, setQuery, activeChannelType, activeChannelIdPart],
  );

  const filtered = results.filter((r) => !existingPubkeys.includes(r.pubkey));
  const showDropdown = query.trim() && (filtered.length > 0 || isSearching);

  return (
    <div className="relative px-1 mb-1">
      <div className="flex items-center gap-2 rounded-xl bg-field border border-border px-2.5 py-1.5 focus-within:border-primary/40 transition-colors">
        <Search size={13} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add feed source..."
          className="flex-1 bg-transparent text-xs text-heading placeholder-muted outline-none"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-muted hover:text-heading">
            <X size={11} />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-1 right-1 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl card-glass shadow-lg">
          {isSearching && filtered.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted">Searching...</p>
          )}
          {filtered.map((r) => (
            <button
              key={r.pubkey}
              onClick={() => handleAdd(r.pubkey)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-card-hover/30 transition-colors"
            >
              <Avatar src={r.profile.picture} alt={r.profile.display_name || r.profile.name || ""} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs text-heading">
                  {r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8) + "..."}
                </p>
              </div>
              <Plus size={13} className="text-muted shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MemberList() {
  const dispatch = useAppDispatch();
  const { activeSpace, activeSpaceId, getActiveChannelType, getActiveChannelIdPart } = useSpace();
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const space = useAppSelector(selectActiveSpace);
  const { can } = usePermissions(activeSpaceId);
  const [showInvite, setShowInvite] = useState(false);
  const [spectatorsOpen, setSpectatorsOpen] = useState(false);

  // Must call all hooks before any early returns
  const communityMembers = activeSpace?.memberPubkeys ?? [];
  const roleGroups = useRoleGroups(activeSpaceId, communityMembers);

  if (!activeSpace || !activeSpaceId || !space) return null;

  const isFeedMode = space.mode === "read";
  const isAdmin = !!currentPubkey && space.adminPubkeys.includes(currentPubkey);
  const canManageFeed = isAdmin || (!!currentPubkey && space.creatorPubkey === currentPubkey);
  const canInvite = can("CREATE_INVITES") || can("MANAGE_MEMBERS") || isAdmin;
  const activeChannelType = getActiveChannelType();
  const activeChIdPart = getActiveChannelIdPart();

  const handleRemoveFeedSource = (pubkey: string) => {
    // Optimistic update
    const updatedPubkeys = space.feedPubkeys.filter((pk) => pk !== pubkey);
    dispatch(updateSpaceFeedSources({ spaceId: activeSpaceId, pubkeys: updatedPubkeys }));
    const updatedSpace: Space = { ...space, feedPubkeys: updatedPubkeys };
    updateSpaceInStore(updatedSpace);

    // Re-subscribe the active channel with updated feed sources
    if (activeChannelType) {
      switchSpaceChannel(updatedSpace, activeChannelType, activeChIdPart);
    }

    // Persist to backend
    removeFeedSourceApi(activeSpaceId, pubkey).catch((err) => {
      console.error("[FeedSources] Failed to remove:", err);
      // Rollback
      dispatch(updateSpaceFeedSources({ spaceId: activeSpaceId, pubkeys: space.feedPubkeys }));
      updateSpaceInStore(space);
      if (activeChannelType) {
        switchSpaceChannel(space, activeChannelType, activeChIdPart);
      }
    });
  };

  // ── Feed Mode: Feed Sources + Spectators ──
  if (isFeedMode) {
    const feedSources = space.feedPubkeys;
    const members = space.memberPubkeys;

    return (
      <div className="p-3 space-y-1">
        {/* Feed Sources section */}
        <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
          Feed Sources ({feedSources.length})
        </div>

        {canManageFeed && (
          <FeedSourceSearch spaceId={activeSpaceId} existingPubkeys={feedSources} activeChannelType={activeChannelType} activeChannelIdPart={activeChIdPart} />
        )}

        {feedSources.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted">
            No feed sources added yet
          </div>
        ) : (
          feedSources.map((pubkey) => (
            <FeedSourceItem
              key={pubkey}
              pubkey={pubkey}
              canManage={canManageFeed}
              onRemove={() => handleRemoveFeedSource(pubkey)}
            />
          ))
        )}

        {/* Spectators (collapsible) */}
        <div className="mt-3 border-t border-border pt-3">
          <button
            onClick={() => setSpectatorsOpen(!spectatorsOpen)}
            className="flex w-full items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted hover:text-soft transition-colors"
          >
            {spectatorsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Spectators ({members.length})
          </button>

          {spectatorsOpen && (
            <div className="mt-1">
              {members.length === 0 ? (
                <div className="px-2 py-2 text-center text-xs text-muted">
                  No spectators yet
                </div>
              ) : (
                members.map((pubkey) => (
                  <MemberItem key={pubkey} pubkey={pubkey} spaceId={activeSpaceId} />
                ))
              )}
            </div>
          )}
        </div>

        {canInvite && (
          <div className="mt-3 border-t border-border pt-3 px-1">
            <button
              onClick={() => setShowInvite(true)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted transition-all duration-150 hover:border-primary/40 hover:text-primary hover:bg-primary/5"
            >
              <Link2 size={13} />
              <span>Invite People</span>
            </button>
          </div>
        )}

        <InviteGenerateModal
          open={showInvite}
          onClose={() => setShowInvite(false)}
          spaceId={activeSpaceId}
          spaceName={activeSpace.name}
        />
      </div>
    );
  }

  // ── Community Mode: Role-grouped member list ──

  return (
    <div className="p-3 space-y-3">
      {roleGroups.length === 0 && communityMembers.length === 0 ? (
        <div className="px-2 py-4 text-center text-xs text-muted">
          No members loaded
        </div>
      ) : (
        roleGroups.map((group) => (
          <div key={group.roleId}>
            <div className="mb-0.5 flex items-center gap-1.5 px-2">
              {group.color && (
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: group.color }}
                />
              )}
              <span
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={group.color ? { color: group.color } : undefined}
              >
                {group.label}
              </span>
              <span className="text-[10px] text-muted">{group.pubkeys.length}</span>
            </div>
            {group.pubkeys.map((pubkey) => (
              <MemberItem
                key={pubkey}
                pubkey={pubkey}
                spaceId={activeSpaceId}
                roleColor={group.color}
              />
            ))}
          </div>
        ))
      )}

      {canInvite && (
        <div className="border-t border-border pt-3 px-1">
          <button
            onClick={() => setShowInvite(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted transition-all duration-150 hover:border-primary/40 hover:text-primary hover:bg-primary/5"
          >
            <Link2 size={13} />
            <span>Invite People</span>
          </button>
        </div>
      )}

      <InviteGenerateModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        spaceId={activeSpaceId}
        spaceName={activeSpace.name}
      />
    </div>
  );
}
