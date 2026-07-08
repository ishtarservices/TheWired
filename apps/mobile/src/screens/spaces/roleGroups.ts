// Discord-style role grouping for the members screen — a port of the desktop
// buildRoleGroups (client/src/features/spaces/buildRoleGroups.ts) over the
// mobile API shapes. Same fallback rules: explicit top role wins; otherwise
// the creator lands in a synthetic Admin group; everyone else in the default.

import type { SpaceMemberRoles, SpaceRoleInfo } from "@/lib/api/spaces";

export interface RoleGroup {
  roleId: string;
  label: string;
  color: string | null;
  position: number;
  pubkeys: string[];
}

const SYNTHETIC_ADMIN_KEY = "__admin_fallback__";
const DEFAULT_KEY = "__default__";

export function buildRoleGroups(
  members: SpaceMemberRoles[],
  roles: SpaceRoleInfo[],
  creatorPubkey: string | null,
): RoleGroup[] {
  const defaultRole = roles.find((r) => r.isDefault);
  const adminRole = [...roles]
    .filter((r) => r.isAdmin)
    .sort((a, b) => a.position - b.position)[0];
  const groupMap = new Map<string, RoleGroup>();

  for (const member of members) {
    const topRole = [...member.roles].sort((a, b) => a.position - b.position)[0];

    let groupKey: string;
    let label: string;
    let color: string | null;
    let position: number;

    if (topRole) {
      groupKey = topRole.id;
      label = topRole.name;
      color = topRole.color;
      position = topRole.position;
    } else if (creatorPubkey && member.pubkey === creatorPubkey) {
      groupKey = SYNTHETIC_ADMIN_KEY;
      label = adminRole?.name ?? "Admin";
      color = adminRole?.color ?? null;
      position = adminRole?.position ?? 0;
    } else {
      groupKey = DEFAULT_KEY;
      label = defaultRole?.name ?? "Members";
      color = defaultRole?.color ?? null;
      position = defaultRole?.position ?? 999;
    }

    let group = groupMap.get(groupKey);
    if (!group) {
      group = { roleId: groupKey, label, color, position, pubkeys: [] };
      groupMap.set(groupKey, group);
    }
    group.pubkeys.push(member.pubkey);
  }

  return [...groupMap.values()].sort((a, b) => a.position - b.position);
}
