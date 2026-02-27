import { useState } from "react";
import { Trash2, GripVertical } from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { useSpaceChannels } from "../useSpaceChannels";
import { CreateChannelModal } from "../CreateChannelModal";

interface ChannelsTabProps {
  spaceId: string;
}

export function ChannelsTab({ spaceId }: ChannelsTabProps) {
  const { channels, updateChannel, deleteChannel } = useSpaceChannels(spaceId);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-heading">Channels</h3>
        <Button variant="neon" size="sm" onClick={() => setCreateOpen(true)}>
          Add Channel
        </Button>
      </div>

      <div className="space-y-1">
        {sorted.map((ch) => (
          <div
            key={ch.id}
            className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-white/[0.04] transition-colors group"
          >
            <GripVertical size={14} className="text-muted shrink-0 cursor-grab" />

            {editingId === ch.id ? (
              <input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onBlur={() => saveEdit(ch.id)}
                onKeyDown={(e) => e.key === "Enter" && saveEdit(ch.id)}
                autoFocus
                className="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.04] px-2 py-0.5 text-sm text-heading focus:border-neon focus:outline-none"
              />
            ) : (
              <button
                className="flex-1 text-left text-sm text-body hover:text-heading"
                onClick={() => startEdit(ch.id, ch.label)}
              >
                {ch.label}
              </button>
            )}

            <span className="text-[10px] text-muted">{ch.type}</span>

            {ch.adminOnly && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                Admin
              </span>
            )}

            {ch.slowModeSeconds > 0 && (
              <span className="text-[10px] text-muted">{ch.slowModeSeconds}s</span>
            )}

            {!ch.isDefault && (
              <button
                onClick={() => deleteChannel(ch.id)}
                className="rounded p-1 text-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 transition-all group-hover:opacity-100"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
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
