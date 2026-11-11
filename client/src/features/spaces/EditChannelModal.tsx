import { useState } from "react";
import { useAppSelector } from "../../store/hooks";
import { X, Trash2, Shield, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useSpaceChannels } from "./useSpaceChannels";
import { usePermissions } from "./usePermissions";
import { CategorySelect, categoryChoiceError, choiceForCategory, type CategoryChoice } from "./CategorySelect";
import { ChannelOverridesPanel } from "./settings/ChannelOverridesPanel";
import { NATIVE_DEFAULT_CHAT_ID } from "./channelLayout";
import type { ChannelFeedMode, SpaceChannel } from "../../types/space";
import type { ChannelPatch } from "../../store/thunks/channelLayout";

interface EditChannelModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  channelId: string | null;
}

/** Edit a channel: name, subfolder, behavior, permissions; or delete it. The
 *  body mounts fresh per open, seeded from the channel as it is now. */
export function EditChannelModal(props: EditChannelModalProps) {
  const channel = useAppSelector((s) =>
    props.channelId ? s.spaces.channels[props.spaceId]?.find((c) => c.id === props.channelId) : undefined,
  );
  if (!props.open || !channel) return null;
  return <EditChannelModalBody {...props} channel={channel} key={channel.id} />;
}

function EditChannelModalBody({
  open,
  onClose,
  spaceId,
  channel,
}: EditChannelModalProps & { channel: SpaceChannel }) {
  const { tree, native, layoutManageable, updateChannel, deleteChannel, createCategory } = useSpaceChannels(spaceId);
  const { can } = usePermissions(spaceId);

  const [name, setName] = useState(() => channel.label.replace(/^#+/, ""));
  const [category, setCategory] = useState<CategoryChoice>(() => choiceForCategory(channel.categoryId));
  const [adminOnly, setAdminOnly] = useState(channel.adminOnly);
  const [slowModeSeconds, setSlowModeSeconds] = useState(channel.slowModeSeconds);
  const [feedMode, setFeedMode] = useState<ChannelFeedMode>(channel.feedMode);
  const [showPerms, setShowPerms] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNativeMainChat = native && (channel.isDefault || channel.id === NATIVE_DEFAULT_CHAT_ID);
  const categoryError = categoryChoiceError(category, tree);
  const cleanName = name.trim().replace(/^#+/, "");

  async function handleSave() {
    if (!cleanName || categoryError) return;
    setSaving(true);
    setError(null);
    try {
      const patch: ChannelPatch = {};
      const label = `#${cleanName}`;
      if (label !== channel.label) patch.label = label;
      if (!native) {
        if (adminOnly !== channel.adminOnly) patch.adminOnly = adminOnly;
        if (channel.type === "chat" && slowModeSeconds !== channel.slowModeSeconds) patch.slowModeSeconds = slowModeSeconds;
      }
      if (channel.type === "music" && feedMode !== channel.feedMode) patch.feedMode = feedMode;

      let targetCategory: string | null = channel.categoryId ?? null;
      if (category.kind === "none") targetCategory = null;
      if (category.kind === "existing") targetCategory = category.id;
      if (category.kind === "new") {
        targetCategory = layoutManageable ? await createCategory(category.name) : category.name.trim();
      }
      if (targetCategory !== (channel.categoryId ?? null)) patch.categoryId = targetCategory;

      if (Object.keys(patch).length > 0) await updateChannel(channel.id, patch);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the channel");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Modal open={open && !confirmDelete} onClose={onClose}>
        <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-heading">Edit Channel</h2>
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
              <label htmlFor="edit-channel-name" className="mb-1 block text-xs font-medium text-soft">
                Channel Name
              </label>
              <div className="flex items-center gap-1">
                <span className="text-sm text-muted">#</span>
                <input
                  id="edit-channel-name"
                  type="text"
                  value={name}
                  maxLength={99}
                  onChange={(e) => setName(e.target.value.replace(/\s+/g, "-").toLowerCase())}
                  className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
                />
              </div>
            </div>

            <CategorySelect tree={tree} value={category} onChange={setCategory} allowCreate />

            {channel.type === "music" && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-soft">Curated (only shared tracks)</span>
                <input
                  type="checkbox"
                  aria-label="Curated feed"
                  checked={feedMode === "curated"}
                  onChange={(e) => setFeedMode(e.target.checked ? "curated" : "all")}
                />
              </div>
            )}

            {!native && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="edit-admin-only"
                  checked={adminOnly}
                  onChange={(e) => setAdminOnly(e.target.checked)}
                  className="rounded border-border"
                />
                <label htmlFor="edit-admin-only" className="text-sm text-soft">
                  Admin-only channel
                </label>
              </div>
            )}

            {!native && channel.type === "chat" && (
              <div>
                <label htmlFor="edit-slowmode" className="mb-1 block text-xs font-medium text-soft">
                  Slow Mode (seconds)
                </label>
                <input
                  id="edit-slowmode"
                  type="number"
                  min="0"
                  max="21600"
                  value={slowModeSeconds}
                  onChange={(e) => setSlowModeSeconds(Math.min(21_600, Math.max(0, parseInt(e.target.value) || 0)))}
                  className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading focus:border-primary focus:outline-none transition-colors"
                />
              </div>
            )}

            {!native && can("MANAGE_ROLES") && (
              <div className="rounded-xl border border-border">
                <button
                  onClick={() => setShowPerms((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-soft hover:text-heading"
                >
                  <Shield size={14} />
                  Permissions
                  <span className="ml-auto">{showPerms ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                </button>
                {showPerms && (
                  <div className="border-t border-border p-3">
                    <ChannelOverridesPanel spaceId={spaceId} channelId={channel.id} />
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

          <div className="mt-6 flex items-center gap-2">
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isNativeMainChat}
              title={isNativeMainChat ? "The space's main chat can't be deleted" : "Delete channel"}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={handleSave} disabled={!cleanName || !!categoryError || saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${channel.label}?`}
        body="The channel is removed for everyone. Its messages stay on the relay but won't be shown here."
        confirmLabel="Delete channel"
        danger
        onConfirm={async () => {
          await deleteChannel(channel.id);
          onClose();
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
