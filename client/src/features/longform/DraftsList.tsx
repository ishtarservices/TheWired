import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Pencil, Trash2, Check, X } from "lucide-react";
import { useRelativeTime } from "@/hooks/useRelativeTime";
import { useArticleDrafts } from "./useArticleDraft";
import type { ArticleDraftRecord } from "@/types/media";

/**
 * Device-local article drafts manager. Lists this account's saved drafts with
 * open / rename / delete. Surfaced on the own-profile Reads tab. Nothing here
 * touches a relay — drafts are local-only (see `articleDraftStore.ts`).
 */
export function DraftsList({ pubkey }: { pubkey: string | null }) {
  const { drafts, loading, remove, rename } = useArticleDrafts(pubkey);

  if (loading || drafts.length === 0) {
    // Empty/loading: stay quiet rather than show a placeholder block — the Reads
    // tab already has its own "Write article" entry point above this.
    return null;
  }

  return (
    <div className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Drafts
      </h3>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {drafts.map((draft) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            onRename={(title) => rename(draft.id, title)}
            onDelete={() => remove(draft.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DraftRow({
  draft,
  onRename,
  onDelete,
}: {
  draft: ArticleDraftRecord;
  onRename: (title: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const edited = useRelativeTime(Math.floor(draft.updatedAt / 1000), true);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(draft.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title = draft.title.trim() || "Untitled";

  const commitRename = () => {
    const next = draftTitle.trim();
    if (next && next !== draft.title) void onRename(next);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5">
        <FileText size={15} className="shrink-0 text-muted" />
        <input
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          placeholder="Untitled"
          className="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm text-heading outline-none focus:border-primary"
        />
        <button
          onClick={commitRename}
          title="Save title"
          className="rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <Check size={15} />
        </button>
        <button
          onClick={() => setRenaming(false)}
          title="Cancel"
          className="rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-hover">
      <button
        onClick={() => navigate(`/write?draft=${draft.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <FileText size={15} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-heading">{title}</span>
          <span className="block text-xs text-muted">Edited {edited}</span>
        </span>
      </button>

      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted">Delete?</span>
          <button
            onClick={() => {
              void onDelete();
              setConfirmDelete(false);
            }}
            className="rounded-md px-2 py-1 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/10"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-md px-2 py-1 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading"
          >
            No
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={() => {
              setDraftTitle(draft.title);
              setRenaming(true);
            }}
            title="Rename"
            className="rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-heading"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            title="Delete draft"
            className="rounded-md p-1.5 text-soft transition-colors hover:bg-surface-hover hover:text-red-400"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
