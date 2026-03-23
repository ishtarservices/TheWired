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
  // Text & Content
  SEND_MESSAGES = "SEND_MESSAGES",
  MANAGE_MESSAGES = "MANAGE_MESSAGES",
  PIN_MESSAGES = "PIN_MESSAGES",
  EMBED_LINKS = "EMBED_LINKS",
  ATTACH_FILES = "ATTACH_FILES",
  ADD_REACTIONS = "ADD_REACTIONS",
  MENTION_EVERYONE = "MENTION_EVERYONE",

  // Voice & Video
  CONNECT = "CONNECT",
  SPEAK = "SPEAK",
  VIDEO = "VIDEO",
  SCREEN_SHARE = "SCREEN_SHARE",

  // Channel
  VIEW_CHANNEL = "VIEW_CHANNEL",
  READ_MESSAGE_HISTORY = "READ_MESSAGE_HISTORY",
  MANAGE_CHANNELS = "MANAGE_CHANNELS",

  // Members
  MANAGE_MEMBERS = "MANAGE_MEMBERS",
  MANAGE_ROLES = "MANAGE_ROLES",
  CREATE_INVITES = "CREATE_INVITES",
  MANAGE_INVITES = "MANAGE_INVITES",
  BAN_MEMBERS = "BAN_MEMBERS",
  MUTE_MEMBERS = "MUTE_MEMBERS",

  // Space
  MANAGE_SPACE = "MANAGE_SPACE",
  VIEW_ANALYTICS = "VIEW_ANALYTICS",
}

/** All permission values as a flat array (useful for admin grants) */
export const ALL_PERMISSIONS = Object.values(Permission);

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
