import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../../../components/ui/Button";
import { useRoles } from "../useRoles";

const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  VIEW_CHANNEL: "See this channel in the channel list",
  SEND_MESSAGES: "Send messages in text channels",
  EMBED_LINKS: "Preview links and embeds in messages",
  ATTACH_FILES: "Upload images, videos, and files",
  ADD_REACTIONS: "React to messages",
  MENTION_EVERYONE: "Use @everyone to notify all members",
  READ_MESSAGE_HISTORY: "View messages sent before joining",
  CREATE_INVITES: "Create invite links for the space",
  CONNECT: "Join voice and video channels",
  SPEAK: "Talk in voice channels",
  VIDEO: "Share camera in video channels",
  SCREEN_SHARE: "Share screen in voice/video channels",
  MANAGE_MESSAGES: "Delete or edit other members' messages",
  BAN_MEMBERS: "Permanently ban members from the space",
  MUTE_MEMBERS: "Temporarily mute members",
  PIN_MESSAGES: "Pin messages in channels",
  MANAGE_MEMBERS: "Kick members and manage the member list",
  MANAGE_ROLES: "Create, edit, and assign roles",
  MANAGE_CHANNELS: "Create, edit, and delete channels",
  MANAGE_SPACE: "Edit space name, description, and settings",
  MANAGE_INVITES: "View and revoke invite links",
  VIEW_ANALYTICS: "View space analytics and stats",
};

const PERMISSION_GROUPS = [
  {
    label: "General",
    permissions: [
      "VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES",
      "ADD_REACTIONS", "MENTION_EVERYONE", "READ_MESSAGE_HISTORY", "CREATE_INVITES",
    ],
  },
  {
    label: "Voice & Video",
    permissions: ["CONNECT", "SPEAK", "VIDEO", "SCREEN_SHARE"],
  },
  {
    label: "Moderation",
    permissions: ["MANAGE_MESSAGES", "BAN_MEMBERS", "MUTE_MEMBERS", "PIN_MESSAGES"],
  },
  {
    label: "Administration",
    permissions: [
      "MANAGE_MEMBERS", "MANAGE_ROLES", "MANAGE_CHANNELS",
      "MANAGE_SPACE", "MANAGE_INVITES", "VIEW_ANALYTICS",
    ],
  },
];

const ROLE_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e",
  "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899",
];

interface RolesTabProps {
  spaceId: string;
}

export function RolesTab({ spaceId }: RolesTabProps) {
  const { roles, createRole, updateRole, deleteRole } = useRoles(spaceId);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState("");

  const sorted = [...roles].sort((a, b) => a.position - b.position);

  async function handleCreateRole() {
    if (!newRoleName.trim()) return;
    await createRole({
      name: newRoleName.trim(),
      permissions: [
        "VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES",
        "ADD_REACTIONS", "CONNECT", "SPEAK", "VIDEO", "SCREEN_SHARE",
        "READ_MESSAGE_HISTORY", "CREATE_INVITES",
      ],
    });
    setNewRoleName("");
  }

  async function handleCopyRole(sourceRole: { name: string; color?: string; permissions: string[] }) {
    await createRole({
      name: `${sourceRole.name} (copy)`,
      color: sourceRole.color,
      permissions: [...sourceRole.permissions],
    });
  }

  function togglePermission(roleId: string, permission: string, currentPerms: string[]) {
    const next = currentPerms.includes(permission)
      ? currentPerms.filter((p) => p !== permission)
      : [...currentPerms, permission];
    updateRole(roleId, { permissions: next });
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-heading">Roles</h3>

      <div className="space-y-1">
        {sorted.map((role) => {
          const isExpanded = expandedId === role.id;
          const isProtected = role.isDefault || role.isAdmin;

          return (
            <div key={role.id} className="card-glass rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : role.id)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover transition-colors"
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: role.color ?? "#6b7280" }}
                />
                <span className="text-heading font-medium">{role.name}</span>
                {role.isAdmin && (
                  <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">Admin</span>
                )}
                {role.isDefault && (
                  <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">Default</span>
                )}
              </button>

              {isExpanded && (
                <div className="border-t border-edge p-3 space-y-3">
                  {/* Name */}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Name
                    </label>
                    <input
                      value={role.name}
                      onChange={(e) => updateRole(role.id, { name: e.target.value })}
                      disabled={isProtected}
                      className="w-full rounded-xl bg-field border border-edge px-2 py-1 text-sm text-heading focus:border-neon focus:outline-none disabled:opacity-50"
                    />
                  </div>

                  {/* Color */}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Color
                    </label>
                    <div className="flex gap-1.5">
                      {ROLE_COLORS.map((color) => (
                        <button
                          key={color}
                          onClick={() => updateRole(role.id, { color })}
                          className={cn(
                            "h-6 w-6 rounded-full transition-transform hover:scale-110",
                            role.color === color && "ring-2 ring-edge-light ring-offset-1 ring-offset-surface",
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Permissions */}
                  {!role.isAdmin && (
                    <div>
                      <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                        Permissions
                      </label>
                      {PERMISSION_GROUPS.map((group) => (
                        <div key={group.label} className="mb-2">
                          <div className="text-[10px] font-medium text-soft mb-1">{group.label}</div>
                          <div className="space-y-1">
                            {group.permissions.map((perm) => (
                              <label
                                key={perm}
                                className="flex items-start gap-2 text-xs text-body cursor-pointer py-0.5"
                              >
                                <input
                                  type="checkbox"
                                  checked={role.permissions.includes(perm)}
                                  onChange={() => togglePermission(role.id, perm, role.permissions)}
                                  className="rounded border-edge mt-0.5"
                                />
                                <span className="flex-1">
                                  <span className="block">{perm.replace(/_/g, " ").toLowerCase()}</span>
                                  {PERMISSION_DESCRIPTIONS[perm] && (
                                    <span className="block text-[10px] text-muted leading-tight">
                                      {PERMISSION_DESCRIPTIONS[perm]}
                                    </span>
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2">
                    {!isProtected && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-400 hover:bg-red-500/10"
                        onClick={() => deleteRole(role.id)}
                      >
                        <Trash2 size={14} className="mr-1" />
                        Delete
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-soft hover:bg-surface-hover"
                      onClick={() => handleCopyRole(role)}
                    >
                      <Copy size={14} className="mr-1" />
                      Duplicate
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Create new role */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          placeholder="New role name..."
          onKeyDown={(e) => e.key === "Enter" && handleCreateRole()}
          className="flex-1 rounded-xl bg-field border border-edge px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
        />
        <Button variant="neon" size="md" onClick={handleCreateRole} disabled={!newRoleName.trim()}>
          Add Role
        </Button>
      </div>
    </div>
  );
}
