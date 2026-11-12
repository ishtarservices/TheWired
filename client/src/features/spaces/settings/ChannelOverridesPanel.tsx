import { useState, useEffect, useCallback } from "react";
import { Check, X, Minus, Link2, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRoles } from "../useRoles";
import * as rolesApi from "../../../lib/api/roles";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { loadChannelLayout, syncChannelPermissions } from "../../../store/thunks/channelLayout";

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

type OverrideTarget = { kind: "channel"; id: string } | { kind: "category"; id: string };

interface ChannelOverridesPanelProps {
  spaceId: string;
  channelId: string;
}

/** Per-role permission overrides for one channel, with its subfolder sync state. */
export function ChannelOverridesPanel({ spaceId, channelId }: ChannelOverridesPanelProps) {
  return <OverridesPanel spaceId={spaceId} target={{ kind: "channel", id: channelId }} />;
}

/** Per-role permission templates for a subfolder; its synced channels follow them. */
export function CategoryOverridesPanel({ spaceId, categoryId }: { spaceId: string; categoryId: string }) {
  return <OverridesPanel spaceId={spaceId} target={{ kind: "category", id: categoryId }} />;
}

/** "Synced with ‹subfolder›" / "Not synced · Sync now" for a channel in a subfolder. */
function SyncBanner({ spaceId, channelId, reloadKey }: { spaceId: string; channelId: string; reloadKey: () => void }) {
  const dispatch = useAppDispatch();
  const channel = useAppSelector((s) => s.spaces.channels[spaceId]?.find((c) => c.id === channelId));
  const category = useAppSelector((s) =>
    channel?.categoryId ? s.spaces.categories[spaceId]?.find((c) => c.id === channel.categoryId) : undefined,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!channel?.categoryId || !category) return null;

  if (channel.permissionsSynced) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg bg-primary/5 px-2.5 py-1.5 text-[11px] text-soft">
        <Link2 size={12} className="shrink-0 text-primary" />
        Synced with <span className="font-medium text-heading">{category.name}</span>. Editing here unsyncs this channel.
      </p>
    );
  }
  return (
    <div className="rounded-lg bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-soft">
      <div className="flex items-center gap-1.5">
        <Unlink size={12} className="shrink-0 text-amber-400" />
        <span className="flex-1">
          Not synced with <span className="font-medium text-heading">{category.name}</span>.
        </span>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await dispatch(syncChannelPermissions(spaceId, channelId));
              reloadKey();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Couldn't sync");
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-md bg-primary/15 px-2 py-0.5 font-medium text-primary-soft hover:bg-primary/25 disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Sync now"}
        </button>
      </div>
      {error && <p className="mt-1 text-red-400">{error}</p>}
    </div>
  );
}

function OverridesPanel({ spaceId, target }: { spaceId: string; target: OverrideTarget }) {
  const dispatch = useAppDispatch();
  const { roles } = useRoles(spaceId);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, OverrideState>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Select first non-admin role by default
  useEffect(() => {
    if (roles.length > 0 && !selectedRoleId) {
      const nonAdmin = roles.find((r) => !r.isAdmin);
      setSelectedRoleId(nonAdmin?.id ?? roles[0].id);
    }
  }, [roles, selectedRoleId]);

  // Load overrides when the role (or target) changes
  useEffect(() => {
    if (!selectedRoleId) return;
    let cancelled = false;
    setError(null);
    setSaved(false);

    (async () => {
      try {
        const entry =
          target.kind === "channel"
            ? (await rolesApi.fetchChannelOverrides(spaceId, selectedRoleId)).find((o) => o.channelId === target.id)
            : (await rolesApi.fetchCategoryOverrides(spaceId, selectedRoleId)).find((o) => o.categoryId === target.id);
        if (cancelled) return;
        const state: Record<string, OverrideState> = {};
        if (entry) {
          for (const p of entry.allow) state[p] = "allow";
          for (const p of entry.deny) state[p] = "deny";
        }
        setOverrides(state);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load overrides");
      }
    })();

    return () => { cancelled = true; };
  }, [spaceId, selectedRoleId, target.kind, target.id, reloadTick]);

  const handleToggle = useCallback((permission: string, next: OverrideState) => {
    setSaved(false);
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
    setError(null);

    const allow: string[] = [];
    const deny: string[] = [];
    for (const [perm, state] of Object.entries(overrides)) {
      if (state === "allow") allow.push(perm);
      if (state === "deny") deny.push(perm);
    }

    try {
      if (target.kind === "channel") {
        // Only this channel's rows for this role — other channels (and their
        // subfolder sync) are untouched.
        await rolesApi.setChannelOverride(spaceId, selectedRoleId, target.id, { allow, deny });
      } else {
        await rolesApi.setCategoryOverride(spaceId, selectedRoleId, target.id, { allow, deny });
      }
      setSaved(true);
      // Sync badges + inherited channel overrides changed: refresh the layout.
      void dispatch(loadChannelLayout(spaceId)).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save overrides");
    } finally {
      setSaving(false);
    }
  }, [dispatch, spaceId, selectedRoleId, target.kind, target.id, overrides]);

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const nonAdminRoles = roles.filter((r) => !r.isAdmin);

  return (
    <div className="space-y-3">
      {target.kind === "channel" && (
        <SyncBanner spaceId={spaceId} channelId={target.id} reloadKey={() => setReloadTick((t) => t + 1)} />
      )}
      {target.kind === "category" && (
        <p className="text-[11px] text-muted">
          Channels synced with this subfolder follow these settings, and new channels in it start with them.
          A deny on any of someone's roles wins over an allow on another.
        </p>
      )}

      <div className="flex items-center gap-2">
        <span className="label-caps">
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

          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full rounded-xl bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary-soft hover:bg-primary/25 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : saved ? "Saved" : "Save Overrides"}
          </button>
        </div>
      )}
    </div>
  );
}
