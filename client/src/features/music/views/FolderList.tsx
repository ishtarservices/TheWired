import { useState } from "react";
import { Pin, Plus, Globe } from "lucide-react";
import { folderCoverSeeds, folderStatusLine } from "@ishtarservices/core";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { selectFolderMembers, selectFolders } from "../musicSelectors";
import { FolderNameModal } from "../FolderNameModal";
import { FolderCover } from "../FolderCover";
import { createFolder } from "../folderActions";

/** Your folders: private shelves that follow you between devices; a
 *  published one is also a public playlist. */
export function FolderList() {
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const dispatch = useAppDispatch();
  const folders = useAppSelector(selectFolders);
  const members = useAppSelector(selectFolderMembers);
  const [createOpen, setCreateOpen] = useState(false);

  const open = (id: string) => dispatch(setActiveDetailId({ view: "folder-detail", id }));

  return (
    <div className={`flex-1 overflow-y-auto px-8 py-7 ${scrollPaddingClass}`}>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-2xl font-semibold tracking-[-0.02em] text-heading">Folders</h2>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading press-effect"
        >
          <Plus size={14} />
          <span>New folder</span>
        </button>
      </div>
      <p className="mb-3 text-xs text-soft">Private · on your devices. Publish one to share it with anyone.</p>

      {folders.length === 0 ? (
        <div className="flex flex-1 items-center justify-center pt-20">
          <p className="text-sm text-soft">No folders yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          {folders.map((folder) => {
            const cover = folderCoverSeeds(folder, members).find((c) => c.uri)?.uri ?? null;
            return (
              <button
                key={folder.id}
                onClick={() => open(folder.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface"
              >
                <FolderCover uri={cover} className="h-10 w-10 shrink-0 rounded" />
                <div className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-1.5 truncate text-sm text-heading">
                    {folder.pinned && <Pin size={12} className="shrink-0 text-muted" aria-label="Pinned" />}
                    <span className="truncate">{folder.name}</span>
                    {folder.publishedAs && <Globe size={12} className="shrink-0 text-muted" aria-label="Published" />}
                  </p>
                  <p className="truncate text-xs text-soft">{folderStatusLine(folder, members)}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <FolderNameModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(name) => {
          const id = createFolder(name);
          if (id) open(id);
        }}
      />
    </div>
  );
}
