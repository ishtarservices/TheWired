import { useState, useEffect } from "react";
import { X, Trash2, Shield, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { useSpaceChannels } from "./useSpaceChannels";
import { usePermissions } from "./usePermissions";
import { MAX_CATEGORY_NAME_LENGTH, validateCategoryName, renameCategory, removeCategory } from "./channelTree";
import { CategoryOverridesPanel } from "./settings/ChannelOverridesPanel";

interface CategoryModalProps {
  open: boolean;
  onClose: () => void;
  spaceId: string;
  /** Edit this subfolder; omit to create a new one. */
  categoryId?: string | null;
}

/** Create a subfolder, or rename / set permissions on / delete one. */
export function CategoryModal({ open, onClose, spaceId, categoryId }: CategoryModalProps) {
  const { tree, native, applyOp, createCategory } = useSpaceChannels(spaceId);
  const { can } = usePermissions(spaceId);
  const node = categoryId ? tree.categories.find((n) => n.category.id === categoryId) : undefined;
  const editing = !!categoryId;

  const [name, setName] = useState("");
  const [showPerms, setShowPerms] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(node?.category.name ?? "");
    setShowPerms(false);
    setError(null);
  }, [open, categoryId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing && !node) return null;
  const validation = name.trim() ? validateCategoryName(name, tree, categoryId ?? undefined) : null;
  const unchanged = editing && node && name.trim() === node.category.name;

  async function handleSave() {
    if (!name.trim() || validation) return;
    setSaving(true);
    setError(null);
    try {
      if (!editing) await createCategory(name);
      else if (!unchanged) await applyOp(renameCategory(categoryId!, name));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the subfolder");
    } finally {
      setSaving(false);
    }
  }

  const channelCount = node?.channels.length ?? 0;

  return (
    <>
      <Modal open={open && !confirmDelete} onClose={onClose}>
        <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl card-glass p-8 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-heading">{editing ? "Edit Subfolder" : "New Subfolder"}</h2>
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
              <label htmlFor="category-name" className="mb-1 block text-xs font-medium text-soft">
                Name
              </label>
              <input
                id="category-name"
                type="text"
                autoFocus
                value={name}
                maxLength={MAX_CATEGORY_NAME_LENGTH}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="e.g. Text, Voice, Dev"
                className="w-full rounded-xl bg-field border border-border px-3 py-1.5 text-sm text-heading placeholder-muted focus:border-primary focus:outline-none transition-colors"
              />
              {validation && <p className="mt-1 text-[11px] text-red-400">{validation}</p>}
            </div>

            {editing && !native && can("MANAGE_ROLES") && (
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
                    <CategoryOverridesPanel spaceId={spaceId} categoryId={categoryId!} />
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>

          <div className="mt-6 flex items-center gap-2">
            {editing && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleSave}
                disabled={!name.trim() || !!validation || saving || !!unchanged}
              >
                {saving ? "Saving..." : editing ? "Save" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {node && (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete "${node.category.name}"?`}
          body={
            channelCount > 0
              ? `Its ${channelCount} channel${channelCount === 1 ? "" : "s"} will move out of the subfolder. No channels are deleted.`
              : "It has no channels."
          }
          confirmLabel="Delete subfolder"
          danger
          onConfirm={async () => {
            await applyOp(removeCategory(node.category.id));
            onClose();
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </>
  );
}
