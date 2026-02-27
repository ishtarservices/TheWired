import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../../../components/ui/Button";
import { useRoles } from "../useRoles";

const PERMISSION_GROUPS = [
  {
    label: "General",
    permissions: ["SEND_MESSAGES", "CREATE_INVITES"],
  },
  {
    label: "Moderation",
    permissions: ["MANAGE_MESSAGES", "BAN_MEMBERS", "MUTE_MEMBERS", "PIN_MESSAGES"],
  },
  {
    label: "Admin",
    permissions: ["MANAGE_MEMBERS", "MANAGE_ROLES", "MANAGE_CHANNELS", "MANAGE_SPACE", "MANAGE_INVITES", "VIEW_ANALYTICS"],
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
    await createRole({ name: newRoleName.trim(), permissions: ["SEND_MESSAGES"] });
    setNewRoleName("");
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
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-white/[0.04] transition-colors"
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
                <div className="border-t border-white/[0.04] p-3 space-y-3">
                  {/* Name */}
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted">
                      Name
                    </label>
                    <input
                      value={role.name}
                      onChange={(e) => updateRole(role.id, { name: e.target.value })}
                      disabled={isProtected}
                      className="w-full rounded-xl bg-white/[0.04] border border-white/[0.04] px-2 py-1 text-sm text-heading focus:border-neon focus:outline-none disabled:opacity-50"
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
                            role.color === color && "ring-2 ring-white/50 ring-offset-1 ring-offset-surface",
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
                              <label key={perm} className="flex items-center gap-2 text-xs text-body cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={role.permissions.includes(perm)}
                                  onChange={() => togglePermission(role.id, perm, role.permissions)}
                                  className="rounded border-white/[0.04]"
                                />
                                {perm.replace(/_/g, " ").toLowerCase()}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Delete */}
                  {!isProtected && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:bg-red-500/10"
                      onClick={() => deleteRole(role.id)}
                    >
                      <Trash2 size={14} className="mr-1" />
                      Delete Role
                    </Button>
                  )}
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
          className="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.04] px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
        />
        <Button variant="neon" size="md" onClick={handleCreateRole} disabled={!newRoleName.trim()}>
          Add Role
        </Button>
      </div>
    </div>
  );
}
