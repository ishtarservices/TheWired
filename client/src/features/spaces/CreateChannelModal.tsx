import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { useSpaceChannels } from "./useSpaceChannels";
import { CategorySelect, categoryChoiceError, choiceForCategory, type CategoryChoice } from "./CategorySelect";
import type { SpaceChannelType, ChannelFeedMode } from "../../types/space";

/** Feed types that only allow one channel per space */
const UNIQUE_FEED_TYPES = new Set<SpaceChannelType>(["notes", "media", "articles"]);

const ALL_TYPES: { value: SpaceChannelType; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "voice", label: "Voice" },
  { value: "video", label: "Video" },
  { value: "notes", label: "Notes" },
  { value: "media", label: "Media" },
  { value: "articles", label: "Articles" },
  { value: "music", label: "Music" },
];

interface CreateChannelModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Preselect a subfolder (e.g. opened from that subfolder's "+"). */
  defaultCategoryId?: string | null;
}

/** The body mounts fresh per open, starting from the subfolder it was opened for. */
export function CreateChannelModal(props: CreateChannelModalProps) {
  if (!props.open) return null;
  return <CreateChannelModalBody {...props} />;
}

function CreateChannelModalBody({ open, onClose, spaceId, defaultCategoryId }: CreateChannelModalProps) {
  const { channels, tree, native, layoutManageable, createChannel, createCategory } = useSpaceChannels(spaceId);
  const [name, setName] = useState("");
  const [type, setType] = useState<SpaceChannelType>("chat");
  const [category, setCategory] = useState<CategoryChoice>(() => choiceForCategory(defaultCategoryId));
  const [adminOnly, setAdminOnly] = useState(false);
  const [slowModeSeconds, setSlowModeSeconds] = useState(0);
  const [temporary, setTemporary] = useState(false);
  const [feedMode, setFeedMode] = useState<ChannelFeedMode>("all");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const isVoiceOrVideo = type === "voice" || type === "video";

  // Determine which types are disabled (already exist for unique feed types)
  const existingTypes = new Set(channels.map((c) => c.type));
  const disabledTypes = new Set(
    ALL_TYPES
      .filter((t) => UNIQUE_FEED_TYPES.has(t.value) && existingTypes.has(t.value))
      .map((t) => t.value),
  );

  const categoryError = categoryChoiceError(category, tree);

  async function handleCreate() {
    const label = name.trim().replace(/^#+/, "");
    if (!label || categoryError) return;
    setError(null);
    setCreating(true);

    try {
      // A new subfolder is created first and the channel goes into it by id —
      // never by name, which could match another subfolder's legacy id.
      let categoryId: string | null = null;
      if (category.kind === "existing") categoryId = category.id;
      if (category.kind === "new") {
        categoryId = layoutManageable ? await createCategory(category.name) : category.name.trim();
      }
      await createChannel({
        type,
        label: `#${label}`,
        categoryId,
        ...(native ? {} : { adminOnly, slowModeSeconds }),
        ...(!native && isVoiceOrVideo && temporary ? { temporary: true } : {}),
        ...(type === "music" ? { feedMode } : {}),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create channel");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-heading">Create Channel</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-soft hover:bg-card-hover hover:text-heading transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="create-channel-name" className="mb-1 block text-xs font-medium text-soft">
              Channel Name *
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted">#</span>
              <input
                id="create-channel-name"
                type="text"
                value={name.replace(/^#/, "")}
                onChange={(e) => setName(e.target.value.replace(/\s+/g, "-").toLowerCase())}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                placeholder="general"
                maxLength={99}
                className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
              />
            </div>
          </div>

          <div>
            <label htmlFor="create-channel-type" className="mb-1 block text-xs font-medium text-soft">
              Type
            </label>
            <select
              id="create-channel-type"
              value={type}
              onChange={(e) => setType(e.target.value as SpaceChannelType)}
              className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
            >
              {ALL_TYPES.map((t) => (
                <option key={t.value} value={t.value} disabled={disabledTypes.has(t.value)}>
                  {t.label}
                  {disabledTypes.has(t.value) ? " (already exists)" : ""}
                </option>
              ))}
            </select>
          </div>

          {type === "music" && (
            <div>
              <span className="mb-1 block text-xs font-medium text-soft">Feed Mode</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFeedMode("all")}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    feedMode === "all"
                      ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                      : "bg-surface text-soft hover:text-heading"
                  }`}
                >
                  All Members
                </button>
                <button
                  type="button"
                  onClick={() => setFeedMode("curated")}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    feedMode === "curated"
                      ? "bg-primary/15 text-primary-soft ring-1 ring-primary/30"
                      : "bg-surface text-soft hover:text-heading"
                  }`}
                >
                  Curated
                </button>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                {feedMode === "curated"
                  ? "Only tracks explicitly shared or uploaded to this channel"
                  : "Shows all public tracks from space members"}
              </p>
            </div>
          )}

          <CategorySelect tree={tree} value={category} onChange={setCategory} allowCreate />

          {!native && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="adminOnly"
                checked={adminOnly}
                onChange={(e) => setAdminOnly(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="adminOnly" className="text-sm text-soft">
                Admin-only channel
              </label>
            </div>
          )}

          {!native && type === "chat" && (
            <div>
              <label htmlFor="create-channel-slowmode" className="mb-1 block text-xs font-medium text-soft">
                Slow Mode (seconds)
              </label>
              <input
                id="create-channel-slowmode"
                type="number"
                min="0"
                max="21600"
                value={slowModeSeconds}
                onChange={(e) => setSlowModeSeconds(Math.min(21_600, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
              />
            </div>
          )}

          {!native && isVoiceOrVideo && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="temporary"
                checked={temporary}
                onChange={(e) => setTemporary(e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="temporary" className="text-sm text-soft">
                Temporary channel
              </label>
              <span className="text-[10px] text-muted">(deleted when everyone leaves)</span>
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleCreate}
            disabled={!name.trim().replace(/^#+/, "") || !!categoryError || creating}
          >
            {creating ? "Creating..." : "Create Channel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
