import type { SpaceMember, SpaceRole } from "../../types/space";

/**
 * NIP-29 has only a coarse admin/member distinction (39001 admins, 39002
 * members) — no rich Discord-style roles/permissions. For native spaces we
 * synthesize two roles so the existing `MemberList`/`buildRoleGroups`/
 * `usePermissions` UI renders unchanged from the relay's 39001/39002 events.
 */

export const NIP29_ADMIN_ROLE_ID = "__nip29_admin__";
export const NIP29_MEMBER_ROLE_ID = "__nip29_member__";

/** Permissions granted to a native-space admin (full control, coarse). */
export const NIP29_ADMIN_PERMISSIONS: string[] = [
  "MANAGE_SPACE",
  "MANAGE_ROLES",
  "MANAGE_CHANNELS",
  "MANAGE_MEMBERS",
  "MANAGE_MESSAGES",
  // #40 — NIP-29 defines no ban/mute kinds (only kind:9001 remove-user), and our
  // relay stores no ban/mute list, so these would render menu items that silently
  // no-op. Omit them for native spaces; Kick (9001) is the supported action.
  "CREATE_INVITES",
  "MANAGE_INVITES",
  "SEND_MESSAGES",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "CONNECT",
  "SPEAK",
  "VIDEO",
  "SCREEN_SHARE",
  "VIEW_CHANNEL",
  "READ_MESSAGE_HISTORY",
];

/** Permissions for a regular native-space member. */
export const NIP29_MEMBER_PERMISSIONS: string[] = [
  "SEND_MESSAGES",
  "EMBED_LINKS",
  "ATTACH_FILES",
  "ADD_REACTIONS",
  "CONNECT",
  "SPEAK",
  "VIDEO",
  "SCREEN_SHARE",
  "VIEW_CHANNEL",
  "READ_MESSAGE_HISTORY",
];

/** Build the two synthetic roles (Admin + Members) for a native space. */
export function synthesizeNip29Roles(spaceId: string): SpaceRole[] {
  return [
    {
      id: NIP29_ADMIN_ROLE_ID,
      spaceId,
      name: "Admin",
      position: 0,
      isDefault: false,
      isAdmin: true,
      permissions: NIP29_ADMIN_PERMISSIONS,
    },
    {
      id: NIP29_MEMBER_ROLE_ID,
      spaceId,
      name: "Members",
      position: 999,
      isDefault: true,
      isAdmin: false,
      permissions: NIP29_MEMBER_PERMISSIONS,
    },
  ];
}

/**
 * Map a NIP-29 group's member + admin pubkey sets (from 39002 / 39001) onto
 * `SpaceMember[]`, assigning the synthetic admin role to admins and the default
 * member role to everyone else. `buildRoleGroups` then renders them as usual.
 */
export function synthesizeNip29Members(
  spaceId: string,
  memberPubkeys: string[],
  adminPubkeys: string[],
): SpaceMember[] {
  const roles = synthesizeNip29Roles(spaceId);
  const adminRole = roles[0];
  const memberRole = roles[1];
  const adminSet = new Set(adminPubkeys);
  // Admins are always members even if 39002 omits them.
  const all = new Set([...memberPubkeys, ...adminPubkeys]);
  return [...all].map((pubkey) => ({
    pubkey,
    roles: adminSet.has(pubkey) ? [adminRole] : [memberRole],
    joinedAt: 0,
  }));
}

/** The current user's resolved permission set for a native space. */
export function nip29MyPermissions(myPubkey: string | null, adminPubkeys: string[]): string[] {
  if (myPubkey && adminPubkeys.includes(myPubkey)) return NIP29_ADMIN_PERMISSIONS;
  return NIP29_MEMBER_PERMISSIONS;
}
