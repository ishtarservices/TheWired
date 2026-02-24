/** Role hierarchy position (lower = more powerful) */
export interface Role {
  id: string;
  spaceId: string;
  name: string;
  position: number;
  color?: string;
  isDefault: boolean;
  isAdmin: boolean;
  createdAt: number;
}

/** Permission flags */
export enum Permission {
  SEND_MESSAGES = "SEND_MESSAGES",
  MANAGE_MESSAGES = "MANAGE_MESSAGES",
  MANAGE_MEMBERS = "MANAGE_MEMBERS",
  MANAGE_ROLES = "MANAGE_ROLES",
  MANAGE_CHANNELS = "MANAGE_CHANNELS",
  MANAGE_SPACE = "MANAGE_SPACE",
  VIEW_ANALYTICS = "VIEW_ANALYTICS",
  PIN_MESSAGES = "PIN_MESSAGES",
  CREATE_INVITES = "CREATE_INVITES",
  MANAGE_INVITES = "MANAGE_INVITES",
  BAN_MEMBERS = "BAN_MEMBERS",
  MUTE_MEMBERS = "MUTE_MEMBERS",
}

/** Per-role permission set */
export interface RolePermissions {
  roleId: string;
  permissions: Permission[];
}

/** Channel-level permission override */
export interface ChannelOverride {
  roleId: string;
  channelId: string;
  allow: Permission[];
  deny: Permission[];
}

/** Member with roles */
export interface MemberWithRoles {
  pubkey: string;
  spaceId: string;
  roles: Role[];
  joinedAt: number;
  mutedUntil?: number;
  banned: boolean;
}

/** Permission check result */
export interface PermissionCheck {
  allowed: boolean;
  reason?: string;
}
