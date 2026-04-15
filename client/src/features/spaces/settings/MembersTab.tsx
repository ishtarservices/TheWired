import { useState, useCallback } from "react";
import { Search, X, Plus, Rss, ChevronDown, Check } from "lucide-react";
import { Avatar } from "../../../components/ui/Avatar";
import { useProfile } from "../../profile/useProfile";
import { useAppSelector, useAppDispatch } from "../../../store/hooks";
import { useRoles } from "../useRoles";
import { useMemberRoles } from "../useMemberRoles";
import { useUserSearch } from "../../search/useUserSearch";
import { addFeedSources, removeFeedSource as removeFeedSourceApi } from "../../../lib/api/spaces";
import { updateSpaceFeedSources } from "../../../store/slices/spacesSlice";
import { updateSpaceInStore } from "../../../lib/db/spaceStore";
import { switchSpaceChannel } from "../../../lib/nostr/groupSubscriptions";
import { store } from "../../../store";
import { parseChannelIdPart } from "../spaceSelectors";
import type { Space, SpaceRole } from "../../../types/space";

interface MembersTabProps {
  spaceId: string;
}

function RoleBadge({ role, size = "sm" }: { role: SpaceRole; size?: "sm" | "xs" }) {
  const color = role.color ?? "var(--color-muted)";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-px text-[10px]"
      }`}
      style={{
        backgroundColor: `${color}18`,
        color,
        border: `1px solid ${color}40`,
      }}
    >
      <span
        className="shrink-0 rounded-full"
        style={{
          backgroundColor: color,
          width: size === "sm" ? 6 : 5,
          height: size === "sm" ? 6 : 5,
        }}
      />
      {role.name}
    </span>
  );
}

function MemberRow({
  pubkey,
  spaceId,
  memberRoles,
}: {
  pubkey: string;
  spaceId: string;
  memberRoles: SpaceRole[];
}) {
  const { profile } = useProfile(pubkey);
  const { roles: allRoles } = useRoles(spaceId);
  const { assignRole, removeRoleFromMember } = useMemberRoles(spaceId);
  const [expanded, setExpanded] = useState(false);

  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";
  const assignedIds = new Set(memberRoles.map((r) => r.id));

  const handleToggleRole = async (roleId: string) => {
    if (assignedIds.has(roleId)) {
      await removeRoleFromMember(pubkey, roleId);
    } else {
      await assignRole(pubkey, roleId);
    }
  };

  return (
    <div className="rounded-xl transition-colors hover:bg-surface-hover/50">
      {/* Main row */}
      <div
        className="flex items-center gap-2.5 px-2.5 py-2 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Avatar src={profile?.picture} alt={name} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-heading">{name}</span>
            {memberRoles.length > 0 && (
              <div className="flex items-center gap-1 shrink-0 overflow-hidden">
                {memberRoles.slice(0, 2).map((role) => (
                  <RoleBadge key={role.id} role={role} size="xs" />
                ))}
                {memberRoles.length > 2 && (
                  <span className="text-[10px] text-muted">+{memberRoles.length - 2}</span>
                )}
              </div>
            )}
          </div>
          <div className="truncate text-[10px] text-muted font-mono">{pubkey.slice(0, 16)}...</div>
        </div>
        <ChevronDown
          size={14}
          className={`text-muted shrink-0 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
        />
      </div>

      {/* Expanded role management */}
      {expanded && allRoles.length > 0 && (
        <div className="px-2.5 pb-2.5">
          <div className="rounded-lg bg-surface/60 border border-border/50 p-2">
            <div className="flex items-center justify-between mb-1.5 px-0.5">
              <p className="text-[10px] text-muted">Roles</p>
              {memberRoles.length > 0 && (
                <p className="text-[10px] text-muted">{memberRoles.length} assigned</p>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto scrollbar-thin">
              {/* Show assigned roles first, then unassigned */}
              {[...allRoles]
                .sort((a, b) => {
                  const aAssigned = assignedIds.has(a.id) ? 0 : 1;
                  const bAssigned = assignedIds.has(b.id) ? 0 : 1;
                  return aAssigned - bAssigned || a.position - b.position;
                })
                .map((role) => {
                  const isAssigned = assignedIds.has(role.id);
                  const color = role.color ?? "var(--color-muted)";
                  return (
                    <button
                      key={role.id}
                      onClick={() => handleToggleRole(role.id)}
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 hover:brightness-125 active:scale-[0.97]"
                      style={
                        isAssigned
                          ? {
                              backgroundColor: `${color}25`,
                              color,
                              border: `1.5px solid ${color}60`,
                            }
                          : {
                              backgroundColor: "transparent",
                              color: "var(--color-muted)",
                              border: "1.5px dashed #374151",
                            }
                      }
                    >
                      {isAssigned ? (
                        <Check size={10} strokeWidth={3} />
                      ) : (
                        <Plus size={10} strokeWidth={2} />
                      )}
                      <span
                        className="shrink-0 rounded-full"
                        style={{
                          backgroundColor: isAssigned ? color : "var(--color-muted)",
                          width: 6,
                          height: 6,
                          opacity: isAssigned ? 1 : 0.4,
                        }}
                      />
                      {role.name}
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedSourceRow({
  pubkey,
  onRemove,
}: {
  pubkey: string;
  onRemove: () => void;
}) {
  const { profile } = useProfile(pubkey);
  const name = profile?.display_name || profile?.name || pubkey.slice(0, 8) + "...";

  return (
    <div className="group flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-surface-hover transition-colors">
      <Avatar src={profile?.picture} alt={name} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm text-heading">{name}</div>
        <div className="truncate text-[10px] text-muted font-mono">{pubkey.slice(0, 16)}...</div>
      </div>
      <Rss size={12} className="text-primary/60 shrink-0" />
      <button
        onClick={onRemove}
        className="rounded p-1 text-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 transition-all group-hover:opacity-100"
        title="Remove from feed"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function MembersTab({ spaceId }: MembersTabProps) {
  const dispatch = useAppDispatch();
  const space = useAppSelector((s) => s.spaces.list.find((sp) => sp.id === spaceId));
  const currentPubkey = useAppSelector((s) => s.identity.pubkey);
  const [memberFilter, setMemberFilter] = useState("");
  const { query, setQuery, results, isSearching } = useUserSearch();
  const { members: memberData } = useMemberRoles(spaceId);

  const isFeedMode = space?.mode === "read";
  const canManageFeed = !!currentPubkey && (
    space?.creatorPubkey === currentPubkey ||
    !!space?.adminPubkeys.includes(currentPubkey)
  );

  /** Re-subscribe the active channel after feed source changes */
  const resubscribeActiveChannel = useCallback(
    (updatedSpace: Space) => {
      const state = store.getState();
      if (state.spaces.activeSpaceId !== spaceId || !state.spaces.activeChannelId) return;
      const spaceChannels = state.spaces.channels[spaceId];
      const channelIdPart = parseChannelIdPart(state.spaces.activeChannelId);
      const channel = spaceChannels?.find((c) => c.id === channelIdPart);
      if (channel) {
        switchSpaceChannel(updatedSpace, channel.type, channel.id);
      }
    },
    [spaceId],
  );

  const handleAddFeedSource = useCallback(
    async (pubkey: string) => {
      if (!space) return;

      const updatedPubkeys = [...space.feedPubkeys, pubkey];
      dispatch(updateSpaceFeedSources({ spaceId, pubkeys: updatedPubkeys }));
      const updatedSpace: Space = { ...space, feedPubkeys: updatedPubkeys };
      updateSpaceInStore(updatedSpace);
      resubscribeActiveChannel(updatedSpace);
      setQuery("");

      addFeedSources(spaceId, [pubkey]).catch((err) => {
        console.error("[FeedSources] Failed to add:", err);
        dispatch(updateSpaceFeedSources({ spaceId, pubkeys: space.feedPubkeys }));
        updateSpaceInStore(space);
        resubscribeActiveChannel(space);
      });
    },
    [dispatch, space, spaceId, setQuery, resubscribeActiveChannel],
  );

  const handleRemoveFeedSource = useCallback(
    (pubkey: string) => {
      if (!space) return;

      const updatedPubkeys = space.feedPubkeys.filter((pk) => pk !== pubkey);
      dispatch(updateSpaceFeedSources({ spaceId, pubkeys: updatedPubkeys }));
      const updatedSpace: Space = { ...space, feedPubkeys: updatedPubkeys };
      updateSpaceInStore(updatedSpace);
      resubscribeActiveChannel(updatedSpace);

      removeFeedSourceApi(spaceId, pubkey).catch((err) => {
        console.error("[FeedSources] Failed to remove:", err);
        dispatch(updateSpaceFeedSources({ spaceId, pubkeys: space.feedPubkeys }));
        updateSpaceInStore(space);
        resubscribeActiveChannel(space);
      });
    },
    [dispatch, space, spaceId, resubscribeActiveChannel],
  );

  if (!space) return null;

  // Merge relay-known members and backend-known members (deduplicated)
  const relayMembers = space.memberPubkeys;
  const backendPubkeys = memberData.map((m) => m.pubkey);
  const allPubkeys = [...new Set([...relayMembers, ...backendPubkeys])];
  const memberRolesMap = new Map(memberData.map((m) => [m.pubkey, m.roles]));
  const filteredMembers = memberFilter
    ? allPubkeys.filter((pk) => pk.includes(memberFilter.toLowerCase()))
    : allPubkeys;

  const feedSearchFiltered = results.filter((r) => !space.feedPubkeys.includes(r.pubkey));
  const showFeedDropdown = query.trim() && (feedSearchFiltered.length > 0 || isSearching);

  return (
    <div className="space-y-6">
      {/* Feed Sources section (feed-mode only) */}
      {isFeedMode && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-heading">
            Feed Sources ({space.feedPubkeys.length})
          </h3>
          <p className="text-xs text-muted">
            Users whose content appears in this feed. Only admins can manage this list.
          </p>

          {canManageFeed && (
            <div className="relative">
              <div className="flex items-center gap-2 rounded-xl bg-field border border-border px-3 py-1.5 focus-within:border-primary transition-colors">
                <Search size={14} className="text-muted shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search users to add..."
                  className="flex-1 bg-transparent text-sm text-heading placeholder-muted outline-none"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-muted hover:text-heading">
                    <X size={12} />
                  </button>
                )}
              </div>

              {showFeedDropdown && (
                <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl card-glass shadow-lg">
                  {isSearching && feedSearchFiltered.length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted">Searching...</p>
                  )}
                  {feedSearchFiltered.map((r) => (
                    <button
                      key={r.pubkey}
                      onClick={() => handleAddFeedSource(r.pubkey)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-card-hover/30 transition-colors"
                    >
                      <Avatar src={r.profile.picture} alt={r.profile.display_name || r.profile.name || ""} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-heading">
                          {r.profile.display_name || r.profile.name || r.pubkey.slice(0, 8) + "..."}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {r.profile.nip05 || r.pubkey.slice(0, 12) + "..."}
                        </p>
                      </div>
                      <Plus size={14} className="text-muted shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-0.5 max-h-60 overflow-y-auto">
            {space.feedPubkeys.length === 0 ? (
              <div className="py-4 text-center text-xs text-muted">No feed sources added</div>
            ) : (
              space.feedPubkeys.map((pubkey) => (
                <FeedSourceRow
                  key={pubkey}
                  pubkey={pubkey}
                  onRemove={() => handleRemoveFeedSource(pubkey)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Members section */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-heading">
          {isFeedMode ? "Spectators" : "Members"} ({allPubkeys.length})
        </h3>

        <input
          type="text"
          value={memberFilter}
          onChange={(e) => setMemberFilter(e.target.value)}
          placeholder={`Filter ${isFeedMode ? "spectators" : "members"}...`}
          className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
        />

        <div className="space-y-0.5 max-h-96 overflow-y-auto">
          {filteredMembers.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted">
              No {isFeedMode ? "spectators" : "members"} found
            </div>
          ) : (
            filteredMembers.map((pubkey) => (
              <MemberRow
                key={pubkey}
                pubkey={pubkey}
                spaceId={spaceId}
                memberRoles={memberRolesMap.get(pubkey) ?? []}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
