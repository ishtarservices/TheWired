import { useMemo, useState } from "react";
import { Play, Shuffle, Folder, FolderPlus, Check } from "lucide-react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { setActiveDetailId } from "@/store/slices/musicSlice";
import { BackLink } from "../BackLink";
import { useProfile } from "@/features/profile/useProfile";
import { getDisplayName } from "@/features/dm/dmUtils";
import { TrackRow } from "../TrackRow";
import { useAudioPlayer } from "../useAudioPlayer";
import { usePlaybackBarSpacing } from "@/hooks/usePlaybackBarSpacing";
import { createFolder } from "../folderActions";
import { FolderCover } from "../FolderCover";

/** A folder someone published (a kind-30119 on the wire). The music section
 *  has one word for a shelf — folder: yours open as editable folders, anyone
 *  else's can be saved as a folder of your own (its tracks, yours to reorder
 *  and publish under your own address). Same model as the mobile app. */
export function PublishedFolderDetail() {
  const dispatch = useAppDispatch();
  const address = useAppSelector((s) => s.music.activeDetailId);
  const published = useAppSelector((s) => (address ? s.music.playlists[address] : undefined));
  const linkedFolder = useAppSelector((s) =>
    address ? s.music.folders.find((f) => f.publishedAs === address) : undefined,
  );
  const tracks = useAppSelector((s) => s.music.tracks);
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const { profile } = useProfile(published?.pubkey ?? "");
  const { playQueue } = useAudioPlayer();
  const { scrollPaddingClass } = usePlaybackBarSpacing();
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const folderTracks = useMemo(() => {
    if (!published) return [];
    return published.trackRefs.map((id) => tracks[id]).filter(Boolean);
  }, [published, tracks]);

  if (!published || published.deleted) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-soft">{published?.deleted ? "This folder was unpublished" : "Folder unavailable"}</p>
        <BackLink className="ml-0" />
      </div>
    );
  }

  const isOwner = pubkey === published.pubkey;
  const queueIds = folderTracks.map((t) => t.addressableId);
  const openFolder = (id: string) => dispatch(setActiveDetailId({ view: "folder-detail", id }));
  const by = isOwner ? "you" : getDisplayName(profile, published.pubkey);

  return (
    <div className={`flex-1 overflow-y-auto ${scrollPaddingClass}`}>
      <div className="px-8 pt-5">
        <BackLink />
      </div>
      <div className="flex items-end gap-7 px-8 pb-7 pt-5">
        <FolderCover uri={published.imageUrl ?? null} className="h-44 w-44 shrink-0 rounded-xl shadow-[var(--shadow-lg)] ring-1 ring-inset ring-border-light" iconSize={48} />
        <div className="flex-1">
          <p className="label-caps text-soft">Folder · by {by}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.025em] text-heading">{published.title}</h1>
          {published.description && <p className="mt-1 text-sm text-soft">{published.description}</p>}
          <p className="text-sm text-soft">
            {published.trackRefs.length} track{published.trackRefs.length !== 1 ? "s" : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => playQueue(queueIds, 0)}
              disabled={queueIds.length === 0}
              className="flex h-9 items-center gap-2 rounded-full bg-heading pl-3.5 pr-4 text-[13px] font-medium text-background transition-opacity hover:opacity-90 press-effect disabled:opacity-40"
              aria-label="Play folder"
            >
              <Play size={14} fill="currentColor" />
              Play All
            </button>
            <button
              onClick={() => playQueue([...queueIds].sort(() => Math.random() - 0.5), 0)}
              disabled={queueIds.length === 0}
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading disabled:opacity-50"
            >
              <Shuffle size={14} />
              Shuffle
            </button>
            {linkedFolder ? (
              <button
                onClick={() => openFolder(linkedFolder.id)}
                className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading"
              >
                <Folder size={14} />
                {isOwner ? "Edit folder" : "Already in your folders"}
              </button>
            ) : (
              <button
                onClick={() => {
                  if (savedAs) return openFolder(savedAs);
                  const id = createFolder(published.title || "Saved folder", published.trackRefs);
                  if (id) setSavedAs(id);
                }}
                className="flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm text-soft transition-colors hover:border-faint hover:text-heading"
              >
                {savedAs ? <Check size={14} /> : <FolderPlus size={14} />}
                {savedAs ? "Saved — open folder" : "Save as folder"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        {folderTracks.length > 0 ? (
          folderTracks.map((track, i) => (
            <TrackRow key={track.addressableId} track={track} index={i} queueTracks={queueIds} />
          ))
        ) : (
          <p className="text-sm text-soft">This folder's tracks aren't reachable from your relays.</p>
        )}
      </div>
    </div>
  );
}
