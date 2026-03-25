import { useState, useEffect, useCallback } from "react";
import { Check, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRoles } from "../useRoles";
import * as rolesApi from "../../../lib/api/roles";

type OverrideState = "inherit" | "allow" | "deny";

const OVERRIDE_PERMISSION_GROUPS = [
  {
    label: "General",
    permissions: [
      "VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS", "ATTACH_FILES",
      "ADD_REACTIONS", "MENTION_EVERYONE", "READ_MESSAGE_HISTORY",
    ],
  },
  {
    label: "Voice & Video",
    permissions: ["CONNECT", "SPEAK", "VIDEO", "SCREEN_SHARE"],
  },
  {
    label: "Moderation",
    permissions: ["MANAGE_MESSAGES", "PIN_MESSAGES"],
  },
];

const PERMISSION_LABELS: Record<string, string> = {
  VIEW_CHANNEL: "View Channel",
  SEND_MESSAGES: "Send Messages",
  EMBED_LINKS: "Embed Links",
  ATTACH_FILES: "Attach Files",
  ADD_REACTIONS: "Add Reactions",
  MENTION_EVERYONE: "Mention Everyone",
  READ_MESSAGE_HISTORY: "Read History",
  CONNECT: "Connect",
  SPEAK: "Speak",
  VIDEO: "Video",
  SCREEN_SHARE: "Screen Share",
  MANAGE_MESSAGES: "Manage Messages",
  PIN_MESSAGES: "Pin Messages",
};

function TriStateToggle({
  state,
  onChange,
}: {
  state: OverrideState;
  onChange: (next: OverrideState) => void;
}) {
  const cycle = () => {
    const order: OverrideState[] = ["inherit", "allow", "deny"];
    const idx = order.indexOf(state);
    onChange(order[(idx + 1) % 3]);
  };

  return (
    <button
      onClick={cycle}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-md transition-all",
        state === "inherit" && "bg-surface-hover text-muted",
        state === "allow" && "bg-green-500/20 text-green-400",
        state === "deny" && "bg-red-500/20 text-red-400",
      )}
      title={state === "inherit" ? "Inherit" : state === "allow" ? "Allow" : "Deny"}
    >
      {state === "inherit" && <Minus size={12} />}
      {state === "allow" && <Check size={12} />}
      {state === "deny" && <X size={12} />}
    </button>
  );
}

interface ChannelOverridesPanelProps {
  spaceId: string;
  channelId: string;
}

export function ChannelOverridesPanel({ spaceId, channelId }: ChannelOverridesPanelProps) {
  const { roles } = useRoles(spaceId);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, OverrideState>>({});
  const [saving, setSaving] = useState(false);

  // Select first non-admin role by default
  useEffect(() => {
    if (roles.length > 0 && !selectedRoleId) {
      const nonAdmin = roles.find((r) => !r.isAdmin);
      setSelectedRoleId(nonAdmin?.id ?? roles[0].id);
    }
  }, [roles, selectedRoleId]);

  // Load overrides when role changes
  useEffect(() => {
    if (!selectedRoleId) return;
    let cancelled = false;

    (async () => {
      try {
        const roleOverrides = await rolesApi.fetchChannelOverrides(spaceId, selectedRoleId);
        if (cancelled) return;
        const channelOv = roleOverrides.find((o) => o.channelId === channelId);
        const state: Record<string, OverrideState> = {};
        if (channelOv) {
          for (const p of channelOv.allow) state[p] = "allow";
          for (const p of channelOv.deny) state[p] = "deny";
        }
        setOverrides(state);
      } catch {
        // Backend unavailable
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, selectedRoleId, channelId]);

  const handleToggle = useCallback((permission: string, next: OverrideState) => {
    setOverrides((prev) => {
      const updated = { ...prev };
      if (next === "inherit") {
        delete updated[permission];
      } else {
        updated[permission] = next;
      }
      return updated;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedRoleId) return;
    setSaving(true);

    const allow: string[] = [];
    const deny: string[] = [];
    for (const [perm, state] of Object.entries(overrides)) {
      if (state === "allow") allow.push(perm);
      if (state === "deny") deny.push(perm);
    }

    try {
      // Fetch existing overrides for other channels, merge with this channel's
      const existing = await rolesApi.fetchChannelOverrides(spaceId, selectedRoleId);
      const otherChannels = existing.filter((o) => o.channelId !== channelId);
      const allOverrides = [
        ...otherChannels.map((o) => ({ channelId: o.channelId, allow: o.allow, deny: o.deny })),
        ...(allow.length > 0 || deny.length > 0 ? [{ channelId, allow, deny }] : []),
      ];
      await rolesApi.setChannelOverrides(spaceId, selectedRoleId, allOverrides);
    } catch (err) {
      console.error("[ChannelOverrides] Save failed:", err);
    } finally {
      setSaving(false);
    }
  }, [spaceId, selectedRoleId, channelId, overrides]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const nonAdminRoles = roles.filter((r) => !r.isAdmin);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Role
        </span>
        <select
          value={selectedRoleId ?? ""}
          onChange={(e) => setSelectedRoleId(e.target.value)}
          className="flex-1 rounded-lg bg-field border border-border px-2 py-1 text-xs text-heading focus:border-primary focus:outline-none"
        >
          {nonAdminRoles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      {selectedRole?.isAdmin && (
        <p className="text-xs text-muted">Admin roles have all permissions and cannot be overridden.</p>
      )}

      {selectedRole && !selectedRole.isAdmin && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 text-[10px] text-muted mb-1">
            <span className="flex items-center gap-1"><Minus size={10} /> Inherit</span>
            <span className="flex items-center gap-1 text-green-400"><Check size={10} /> Allow</span>
            <span className="flex items-center gap-1 text-red-400"><X size={10} /> Deny</span>
          </div>

          {OVERRIDE_PERMISSION_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-medium text-soft mb-1">{group.label}</div>
              <div className="space-y-0.5">
                {group.permissions.map((perm) => (
                  <div key={perm} className="flex items-center justify-between rounded-lg px-2 py-1 hover:bg-surface-hover/50">
                    <span className="text-xs text-body">
                      {PERMISSION_LABELS[perm] ?? perm.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <TriStateToggle
                      state={overrides[perm] ?? "inherit"}
                      onChange={(next) => handleToggle(perm, next)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-xl bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary-soft hover:bg-primary/25 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Overrides"}
          </button>
        </div>
      )}
    </div>
  );
}
