import { useState } from "react";
import { Trash2, GripVertical, Shield, ChevronDown, ChevronRight, Home } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useSpaceChannels } from "../useSpaceChannels";
import { CreateChannelModal } from "../CreateChannelModal";
import { ChannelOverridesPanel } from "./ChannelOverridesPanel";

interface ChannelsTabProps {
  spaceId: string;
}

export function ChannelsTab({ spaceId }: ChannelsTabProps) {
  const { channels, updateChannel, deleteChannel } = useSpaceChannels(spaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [expandedPermsId, setExpandedPermsId] = useState<string | null>(null);

  const sorted = [...channels].sort((a, b) => a.position - b.position);

  function startEdit(channelId: string, label: string) {
    setEditingId(channelId);
    setEditLabel(label);
  }

  async function saveEdit(channelId: string) {
    if (editLabel.trim()) {
      await updateChannel(channelId, { label: editLabel.trim() });
    }
    setEditingId(null);
  }

  function togglePerms(channelId: string) {
    setExpandedPermsId((prev) => (prev === channelId ? null : channelId));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-heading">Channels</h3>
        <Button variant="neon" size="sm" onClick={() => setCreateOpen(true)}>
          Add Channel
        </Button>
      </div>

      <div className="space-y-1">
        {sorted.map((ch) => {
          const isPermsExpanded = expandedPermsId === ch.id;

          return (
            <div key={ch.id} className="card-glass rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-2 py-2 hover:bg-surface-hover transition-colors group">
                <GripVertical size={14} className="text-muted shrink-0 cursor-grab" />

                {editingId === ch.id ? (
                  <input
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    onBlur={() => saveEdit(ch.id)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(ch.id)}
                    autoFocus
                    className="flex-1 min-w-0 rounded-xl bg-field border border-edge px-2 py-0.5 text-sm text-heading focus:border-neon focus:outline-none"
                  />
                ) : (
                  <button
                    className="flex-1 min-w-0 truncate text-left text-sm text-body hover:text-heading"
                    onClick={() => startEdit(ch.id, ch.label)}
                  >
                    {ch.label}
                  </button>
                )}

                {/* Right-side info + actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] text-muted">{ch.type}</span>

                  {ch.adminOnly && (
                    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                      Admin
                    </span>
                  )}

                  {ch.slowModeSeconds > 0 && (
                    <span className="text-[10px] text-muted">{ch.slowModeSeconds}s</span>
                  )}

                  {/* Home channel indicator */}
                  <button
                    onClick={() => {
                      if (!ch.isDefault) updateChannel(ch.id, { isDefault: true });
                    }}
                    className={`shrink-0 rounded p-1 transition-colors ${
                      ch.isDefault
                        ? "text-amber-400"
                        : "text-muted/0 group-hover:text-muted hover:text-amber-400"
                    }`}
                    title={ch.isDefault ? "Home channel" : "Set as home channel"}
                  >
                    <Home size={14} />
                  </button>

                  {/* Permission overrides toggle */}
                  <button
                    onClick={() => togglePerms(ch.id)}
                    className="inline-flex items-center shrink-0 rounded p-1 text-muted hover:bg-card/50 hover:text-heading transition-colors"
                    title="Channel permissions"
                  >
                    <Shield size={14} />
                    {isPermsExpanded
                      ? <ChevronDown size={10} className="ml-0.5" />
                      : <ChevronRight size={10} className="ml-0.5" />}
                  </button>

                  {/* Delete channel */}
                  <button
                    onClick={() => deleteChannel(ch.id)}
                    className="shrink-0 rounded p-1 text-muted/0 group-hover:text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Expanded permission overrides panel */}
              {isPermsExpanded && (
                <div className="border-t border-edge p-3">
                  <ChannelOverridesPanel spaceId={spaceId} channelId={ch.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <CreateChannelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        spaceId={spaceId}
        existingChannels={channels}
      />
    </div>
  );
}
