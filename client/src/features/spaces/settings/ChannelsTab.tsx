import { useState } from "react";
import {
  Trash2,
  GripVertical,
  Shield,
  ChevronDown,
  ChevronRight,
  Home,
  Pencil,
  Plus,
  FolderPlus,
  Link2,
} from "lucide-react";
import { Button } from "../../../components/ui/Button";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { cn } from "@/lib/utils";
import { useSpaceChannels } from "../useSpaceChannels";
import { CreateChannelModal } from "../CreateChannelModal";
import { EditChannelModal } from "../EditChannelModal";
import { CategoryModal } from "../CategoryModal";
import { ChannelOverridesPanel } from "./ChannelOverridesPanel";
import { ChannelTreeDnd, type DragHandle } from "../ChannelTreeDnd";
import { moveCategory, moveChannel, removeCategory, renameCategory, MAX_CATEGORY_NAME_LENGTH, type CategoryNode } from "../channelTree";
import { NATIVE_DEFAULT_CHAT_ID } from "../channelLayout";
import type { SpaceChannel } from "../../../types/space";

interface ChannelsTabProps {
  spaceId: string;
}

function Grip({ handle, label }: { handle?: DragHandle; label: string }) {
  if (!handle) return <GripVertical size={14} className="shrink-0 text-muted/40" />;
  return (
    <button
      ref={handle.ref}
      {...handle.attributes}
      {...(handle.listeners ?? {})}
      aria-label={`Drag to move ${label} (Space to pick up, arrows to move)`}
      className="shrink-0 cursor-grab touch-none rounded p-0.5 text-muted hover:text-heading focus:outline-none focus-visible:ring-1 focus-visible:ring-primary active:cursor-grabbing"
    >
      <GripVertical size={14} />
    </button>
  );
}

/** Settings → Channels & subfolders: arrange, rename, move, and edit. */
export function ChannelsTab({ spaceId }: ChannelsTabProps) {
  const { tree, native, layoutManageable, updateChannel, deleteChannel, applyOp } = useSpaceChannels(spaceId);
  const [createFor, setCreateFor] = useState<{ categoryId: string | null } | null>(null);
  const [categoryModal, setCategoryModal] = useState<{ categoryId: string | null } | null>(null);
  const [editChannelId, setEditChannelId] = useState<string | null>(null);
  const [expandedPermsId, setExpandedPermsId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleteChannelTarget, setDeleteChannelTarget] = useState<SpaceChannel | null>(null);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<CategoryNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((err: unknown) => setError(err instanceof Error ? err.message : "Something went wrong"));
  };

  async function commitRename() {
    if (!renaming) return;
    const node = tree.categories.find((n) => n.category.id === renaming.id);
    const name = renaming.name.trim();
    setRenaming(null);
    if (!node || !name || name === node.category.name) return;
    run(applyOp(renameCategory(renaming.id, name)));
  }

  const hasCategories = tree.categories.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-heading">Channels &amp; subfolders</h3>
          <p className="text-[11px] text-muted">
            {layoutManageable
              ? "Drag to reorder channels and subfolders, or to move a channel into another subfolder."
              : "Subfolders become editable once this space's server is updated."}
          </p>
        </div>
        <div className="flex gap-2">
          {layoutManageable && (
            <Button variant="ghost" size="sm" onClick={() => setCategoryModal({ categoryId: null })}>
              <FolderPlus size={14} className="mr-1" />
              New Subfolder
            </Button>
          )}
          <Button variant="accent" size="sm" onClick={() => setCreateFor({ categoryId: null })}>
            Add Channel
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      {hasCategories && tree.uncategorized.length > 0 && (
        <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">No subfolder</div>
      )}

      <div className="space-y-1">
        <ChannelTreeDnd
          tree={tree}
          enabled={layoutManageable}
          keyboard
          onMoveChannel={(id, cat, index) => run(applyOp(moveChannel(id, cat, index)))}
          onMoveCategory={(id, index) => run(applyOp(moveCategory(id, index)))}
          emptyCategoryHint={
            <p className="ml-6 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-muted">
              Empty — drag channels here or add one.
            </p>
          }
          renderCategoryHeader={(node, ctx) => (
            <div
              className={cn(
                "mt-3 flex items-center gap-2 rounded-xl px-2 py-1.5",
                ctx.overlay ? "card-glass shadow-lg" : "bg-surface/40",
                ctx.dropTarget && "ring-1 ring-primary/40",
              )}
            >
              <Grip handle={ctx.handle} label={`subfolder ${node.category.name}`} />
              {renaming?.id === node.category.id ? (
                <input
                  value={renaming.name}
                  autoFocus
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  aria-label="Subfolder name"
                  onChange={(e) => setRenaming({ id: node.category.id, name: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="flex-1 min-w-0 rounded-lg bg-field border border-border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-heading focus:border-primary focus:outline-none"
                />
              ) : (
                <button
                  disabled={!layoutManageable}
                  onClick={() => setRenaming({ id: node.category.id, name: node.category.name })}
                  title={layoutManageable ? "Rename" : undefined}
                  className="flex-1 min-w-0 truncate text-left text-xs font-semibold uppercase tracking-wider text-soft hover:text-heading disabled:hover:text-soft"
                >
                  {node.category.name}
                </button>
              )}
              <span className="text-[10px] text-muted">{node.channels.length}</span>
              <button
                onClick={() => setCreateFor({ categoryId: node.category.id })}
                className="rounded p-1 text-muted hover:bg-card/50 hover:text-heading"
                title={`Add a channel to ${node.category.name}`}
                aria-label={`Add a channel to ${node.category.name}`}
              >
                <Plus size={14} />
              </button>
              {layoutManageable && (
                <button
                  onClick={() => setCategoryModal({ categoryId: node.category.id })}
                  className="rounded p-1 text-muted hover:bg-card/50 hover:text-heading"
                  title={native ? "Edit subfolder" : "Subfolder settings & permissions"}
                  aria-label={`Edit subfolder ${node.category.name}`}
                >
                  {native ? <Pencil size={14} /> : <Shield size={14} />}
                </button>
              )}
              {layoutManageable && (
                <button
                  onClick={() => setDeleteCategoryTarget(node)}
                  className="rounded p-1 text-muted hover:bg-red-500/10 hover:text-red-400"
                  title="Delete subfolder"
                  aria-label={`Delete subfolder ${node.category.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
          renderChannel={(ch, ctx) => {
            const inCategory = !!ch.categoryId;
            const isPermsExpanded = expandedPermsId === ch.id;
            const isNativeMain = native && (ch.isDefault || ch.id === NATIVE_DEFAULT_CHAT_ID);
            return (
              <div
                className={cn(
                  "mt-1 rounded-xl overflow-hidden",
                  inCategory && "ml-6",
                  ctx.overlay ? "card-glass shadow-lg" : "card-glass",
                )}
              >
                <div className="flex items-center gap-2 px-2 py-2 hover:bg-surface-hover transition-colors group">
                  <Grip handle={ctx.handle} label={ch.label} />
                  <button
                    className="flex-1 min-w-0 truncate text-left text-sm text-body hover:text-heading"
                    onClick={() => setEditChannelId(ch.id)}
                    title="Edit channel"
                  >
                    {ch.label}
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-muted">{ch.type}</span>
                    {inCategory && !native && ch.permissionsSynced && (
                      <span title="Permissions synced with its subfolder" className="text-primary/70">
                        <Link2 size={12} />
                      </span>
                    )}
                    {ch.adminOnly && (
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">Admin</span>
                    )}
                    {ch.slowModeSeconds > 0 && <span className="text-[10px] text-muted">{ch.slowModeSeconds}s</span>}

                    {ch.type === "music" && (
                      <button
                        onClick={() =>
                          run(updateChannel(ch.id, { feedMode: ch.feedMode === "curated" ? "all" : "curated" }))
                        }
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                          ch.feedMode === "curated"
                            ? "bg-primary/15 text-primary"
                            : "bg-surface text-muted hover:text-soft"
                        }`}
                        title={
                          ch.feedMode === "curated"
                            ? "Curated: only explicitly shared tracks appear"
                            : "All Members: shows all public tracks from members"
                        }
                      >
                        {ch.feedMode === "curated" ? "Curated" : "All"}
                      </button>
                    )}

                    {!native && (
                      <button
                        onClick={() => {
                          if (!ch.isDefault) run(updateChannel(ch.id, { isDefault: true }));
                        }}
                        className={`shrink-0 rounded p-1 transition-colors ${
                          ch.isDefault
                            ? "text-amber-400"
                            : "text-muted/0 group-hover:text-muted hover:text-amber-400 focus:text-muted"
                        }`}
                        title={ch.isDefault ? "Home channel" : "Set as home channel"}
                        aria-label={ch.isDefault ? "Home channel" : `Set ${ch.label} as home channel`}
                      >
                        <Home size={14} />
                      </button>
                    )}

                    <button
                      onClick={() => setEditChannelId(ch.id)}
                      className="shrink-0 rounded p-1 text-muted hover:bg-card/50 hover:text-heading"
                      title="Edit channel"
                      aria-label={`Edit ${ch.label}`}
                    >
                      <Pencil size={14} />
                    </button>

                    {!native && (
                      <button
                        onClick={() => setExpandedPermsId((prev) => (prev === ch.id ? null : ch.id))}
                        className="inline-flex items-center shrink-0 rounded p-1 text-muted hover:bg-card/50 hover:text-heading transition-colors"
                        title="Channel permissions"
                        aria-expanded={isPermsExpanded}
                        aria-label={`Permissions for ${ch.label}`}
                      >
                        <Shield size={14} />
                        {isPermsExpanded ? <ChevronDown size={10} className="ml-0.5" /> : <ChevronRight size={10} className="ml-0.5" />}
                      </button>
                    )}

                    <button
                      onClick={() => setDeleteChannelTarget(ch)}
                      disabled={isNativeMain}
                      className="shrink-0 rounded p-1 text-muted/0 group-hover:text-muted hover:text-red-400 hover:bg-red-500/10 focus:text-muted transition-colors disabled:hidden"
                      title="Delete channel"
                      aria-label={`Delete ${ch.label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isPermsExpanded && !ctx.overlay && (
                  <div className="border-t border-border p-3">
                    <ChannelOverridesPanel spaceId={spaceId} channelId={ch.id} />
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>

      <CreateChannelModal
        open={!!createFor}
        onClose={() => setCreateFor(null)}
        spaceId={spaceId}
        defaultCategoryId={createFor?.categoryId ?? null}
      />
      <CategoryModal
        open={!!categoryModal}
        onClose={() => setCategoryModal(null)}
        spaceId={spaceId}
        categoryId={categoryModal?.categoryId}
      />
      <EditChannelModal
        open={!!editChannelId}
        onClose={() => setEditChannelId(null)}
        spaceId={spaceId}
        channelId={editChannelId}
      />
      <ConfirmDialog
        open={!!deleteChannelTarget}
        title={`Delete ${deleteChannelTarget?.label ?? "channel"}?`}
        body="The channel is removed for everyone. Its messages stay on the relay but won't be shown here."
        confirmLabel="Delete channel"
        danger
        onConfirm={() => (deleteChannelTarget ? deleteChannel(deleteChannelTarget.id) : undefined)}
        onClose={() => setDeleteChannelTarget(null)}
      />
      <ConfirmDialog
        open={!!deleteCategoryTarget}
        title={`Delete "${deleteCategoryTarget?.category.name ?? ""}"?`}
        body={
          deleteCategoryTarget && deleteCategoryTarget.channels.length > 0
            ? `Its ${deleteCategoryTarget.channels.length} channel${deleteCategoryTarget.channels.length === 1 ? "" : "s"} will move out of the subfolder. No channels are deleted.`
            : "It has no channels."
        }
        confirmLabel="Delete subfolder"
        danger
        onConfirm={() => (deleteCategoryTarget ? applyOp(removeCategory(deleteCategoryTarget.category.id)) : undefined)}
        onClose={() => setDeleteCategoryTarget(null)}
      />
    </div>
  );
}
