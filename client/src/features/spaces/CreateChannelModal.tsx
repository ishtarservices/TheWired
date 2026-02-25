import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { useSpaceChannels } from "./useSpaceChannels";
import type { SpaceChannel, SpaceChannelType } from "../../types/space";

/** Feed types that only allow one channel per space */
const UNIQUE_FEED_TYPES = new Set<SpaceChannelType>(["notes", "media", "articles", "music"]);

const ALL_TYPES: { value: SpaceChannelType; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "notes", label: "Notes" },
  { value: "media", label: "Media" },
  { value: "articles", label: "Articles" },
  { value: "music", label: "Music" },
];

interface CreateChannelModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  existingChannels: SpaceChannel[];
}

export function CreateChannelModal({
  open,
  onClose,
  spaceId,
  existingChannels,
}: CreateChannelModalProps) {
  const { createChannel } = useSpaceChannels(spaceId);
  const [name, setName] = useState("");
  const [type, setType] = useState<SpaceChannelType>("chat");
  const [adminOnly, setAdminOnly] = useState(false);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Determine which types are disabled (already exist for unique feed types)
  const existingTypes = new Set(existingChannels.map((c) => c.type));
  const disabledTypes = new Set(
    ALL_TYPES
      .filter((t) => UNIQUE_FEED_TYPES.has(t.value) && existingTypes.has(t.value))
      .map((t) => t.value),
  );

  async function handleCreate() {
    if (!name.trim()) return;
    setError(null);
    setCreating(true);

    try {
      await createChannel({
        type,
        label: name.startsWith("#") ? name.trim() : `#${name.trim()}`,
        adminOnly,
        slowModeSeconds,
      });
      setName("");
      setType("chat");
      setAdminOnly(false);
      setSlowModeSeconds(0);
      onClose();
    } catch (err: any) {
      setError(err.message ?? "Failed to create channel");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md rounded-xl glass-panel p-6 shadow-2xl glow-neon">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Create Channel</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Channel Name *
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted">#</span>
              <input
                type="text"
                value={name.replace(/^#/, "")}
                onChange={(e) => setName(e.target.value.replace(/\s+/g, "-").toLowerCase())}
                placeholder="general"
                className="w-full rounded-md border border-edge-light bg-field px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-soft">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as SpaceChannelType)}
              className="w-full rounded-md border border-edge-light bg-field px-3 py-1.5 text-sm text-heading focus:border-neon focus:outline-none transition-colors"
            >
              {ALL_TYPES.map((t) => (
                <option key={t.value} value={t.value} disabled={disabledTypes.has(t.value)}>
                  {t.label}
                  {disabledTypes.has(t.value) ? " (already exists)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="adminOnly"
              checked={adminOnly}
              onChange={(e) => setAdminOnly(e.target.checked)}
              className="rounded border-edge"
            />
            <label htmlFor="adminOnly" className="text-sm text-soft">
              Admin-only channel
            </label>
          </div>

          {type === "chat" && (
            <div>
              <label className="mb-1 block text-xs font-medium text-soft">
                Slow Mode (seconds)
              </label>
              <input
                type="number"
                min="0"
                max="3600"
                value={slowModeSeconds}
                onChange={(e) => setSlowModeSeconds(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full rounded-md border border-edge-light bg-field px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-neon focus:outline-none transition-colors"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleCreate}
            disabled={!name.trim() || creating}
          >
            {creating ? "Creating..." : "Create Channel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
