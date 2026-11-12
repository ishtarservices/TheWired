import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUp,
  Disc3,
  EyeOff,
  Globe,
  Link2,
  Pencil,
  Pin,
  PinOff,
  Play,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { folderCoverSeeds, folderStatusLine } from "@ishtarservices/core";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveDetailId, setMusicView } from "@/store/slices/musicSlice";
import { BackLink } from "../BackLink";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";
import { selectFolderMembers } from "../musicSelectors";
import { buildMusicLink } from "../musicLinks";
import { FolderNameModal } from "../FolderNameModal";
import { FolderCover } from "../FolderCover";
import {
  deleteFolderById,
  flattenToTracks,
  moveInFolder,
  moveInFolderToTop,
  publishFolderById,
  removeFromFolder,
  renameFolderById,
  setFolderPinnedById,
  unpublishFolderById,
} from "../folderActions";

const pill =
  "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading disabled:opacity-50";

export function FolderDetail() {
  const dispatch = useAppDispatch();
  const folderId = useAppSelector((s) => s.music.activeDetailId);
  const folder = useAppSelector((s) => s.music.folders.find((f) => f.id === folderId));
  const tracks = useAppSelector((s) => s.music.tracks);
  const albums = useAppSelector((s) => s.music.albums);
  const members = useAppSelector(selectFolderMembers);
  const { playQueue } = useAudioPlayer();
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState<"publish" | "unpublish" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recomputed when the folder or the catalog changes (projects expand to
  // the tracks the catalog knows).
  const queueIds = useMemo(
    () => (folder ? flattenToTracks(folder.itemIds).filter((id) => !!tracks[id]) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folder, tracks, albums],
  );

  if (!folder) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-soft">Folder not found</p>
      </div>
    );
  }

  const cover = folderCoverSeeds(folder, members).find((c) => c.uri)?.uri ?? null;
  const hasProjects = folder.itemIds.some((id) => id.startsWith("33123:"));

  const run = async (kind: "publish" | "unpublish") => {
    setBusy(kind);
    setError(null);
    try {
      const ok = kind === "publish" ? await publishFolderById(folder.id) : await unpublishFolderById(folder.id);
      if (!ok && kind === "publish") setError("Nothing to publish yet — add a track or a project.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach the relays.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("delete");
    setError(null);
    try {
      await deleteFolderById(folder.id);
      dispatch(setMusicView("folders"));
    } catch (err) {
      // The playlist couldn't be retracted, so the folder stays.
      setError(err instanceof Error ? err.message : "Couldn't take the published copy down.");
      setBusy(null);
    }
  };

  const copyLink = () => {
    if (!folder.publishedAs) return;
    navigator.clipboard.writeText(buildMusicLink(folder.publishedAs)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`flex-1 overflow-y-auto ${scrollPaddingClass}`}>
      <div className="px-8 pt-5">
        <BackLink />
      </div>
      <div className="flex items-end gap-7 px-8 pb-7 pt-5">
        <FolderCover uri={cover} className="h-44 w-44 shrink-0 rounded-xl shadow-[var(--shadow-lg)] ring-1 ring-inset ring-border-light" iconSize={48} />
        <div className="min-w-0 flex-1">
          <p className="label-caps text-soft">
            Folder · {folder.publishedAs ? "published" : "private"}
          </p>
          <h1 className="mt-2 truncate text-3xl font-semibold tracking-[-0.025em] text-heading">{folder.name}</h1>
          <p className="text-sm text-soft">{folderStatusLine(folder, members)}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => playQueue(queueIds, 0)}
              disabled={queueIds.length === 0}
              className="flex h-9 items-center gap-2 rounded-full bg-heading pl-3.5 pr-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 press-effect disabled:opacity-40"
            >
              <Play size={14} fill="currentColor" />
              Play All
            </button>
            <button
              onClick={() => playQueue([...queueIds].sort(() => Math.random() - 0.5), 0)}
              disabled={queueIds.length === 0}
              className={pill}
            >
              <Shuffle size={14} />
              Shuffle
            </button>
            <button onClick={() => setFolderPinnedById(folder.id, !folder.pinned)} className={pill}>
              {folder.pinned ? <PinOff size={14} /> : <Pin size={14} />}
              {folder.pinned ? "Unpin" : "Pin"}
            </button>
            <button onClick={() => setRenaming(true)} className={pill} aria-label="Rename folder">
              <Pencil size={14} />
            </button>
            <button
              onClick={() => run("publish")}
              disabled={busy !== null || folder.itemIds.length === 0}
              className={pill}
              title={
                folder.publishedAs
                  ? "Replaces the published copy"
                  : hasProjects
                    ? "Projects publish as their tracks — anyone can see it"
                    : "Anyone can see it"
              }
            >
              <Globe size={14} />
              {busy === "publish" ? "Publishing…" : folder.publishedAs ? "Update published" : "Publish"}
            </button>
            {folder.publishedAs && (
              <>
                <button onClick={copyLink} className={pill}>
                  <Link2 size={14} />
                  {copied ? "Copied!" : "Copy link"}
                </button>
                <button onClick={() => run("unpublish")} disabled={busy !== null} className={pill}>
                  <EyeOff size={14} />
                  {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
                </button>
              </>
            )}
            {confirmDelete ? (
              <button
                onClick={() => void remove()}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 size={14} />
                {busy === "delete" ? "Deleting…" : folder.publishedAs ? "Delete + unpublish" : "Delete folder"}
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm text-soft transition-colors hover:border-red-500/30 hover:text-red-400"
                aria-label="Delete folder"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          {confirmDelete && (
            <p className="mt-2 text-xs text-soft">
              The music stays in your library{folder.publishedAs ? "; the published copy comes down" : ""}.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>

      <div className="px-6 py-4">
        {folder.itemIds.length === 0 ? (
          <p className="text-sm text-soft">Empty. File tracks and projects here from their “Add to folder” action.</p>
        ) : (
          folder.itemIds.map((id, i) => {
            const track = tracks[id];
            const album = albums[id];
            return (
              <div key={id} className="group/row flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  {track ? (
                    <TrackRow track={track} index={i} queueTracks={queueIds} />
                  ) : album ? (
                    <button
                      onClick={() => dispatch(setActiveDetailId({ view: "album-detail", id }))}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface"
                    >
                      {album.imageUrl ? (
                        <img src={album.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded bg-card">
                          <Disc3 size={16} className="text-muted" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm text-heading">{album.title}</p>
                        <p className="truncate text-xs text-soft">
                          project · {album.trackRefs.length} track{album.trackRefs.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-2">
                      <div className="h-10 w-10 animate-pulse rounded bg-card" />
                      <p className="truncate text-xs text-soft">offline — still loading from relays</p>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
                  <button
                    onClick={() => moveInFolderToTop(folder.id, id)}
                    disabled={i === 0}
                    className="rounded p-0.5 text-muted hover:text-heading disabled:opacity-30"
                    aria-label="Move to top"
                  >
                    <ChevronsUp size={14} />
                  </button>
                  <button
                    onClick={() => moveInFolder(folder.id, id, -1)}
                    disabled={i === 0}
                    className="rounded p-0.5 text-muted hover:text-heading disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    onClick={() => moveInFolder(folder.id, id, 1)}
                    disabled={i === folder.itemIds.length - 1}
                    className="rounded p-0.5 text-muted hover:text-heading disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ChevronDown size={14} />
                  </button>
                  <button
                    onClick={() => removeFromFolder(folder.id, [id])}
                    className="rounded p-0.5 text-muted hover:text-red-400"
                    aria-label="Remove from folder"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <FolderNameModal
        open={renaming}
        onClose={() => setRenaming(false)}
        onSubmit={(name) => renameFolderById(folder.id, name)}
        title="Rename folder"
        submitLabel="Rename"
        initialName={folder.name}
        exceptId={folder.id}
      />
    </div>
  );
}
