import { memo } from "react";
import type { MusicPlaylist } from "@/types/music";
import { useProfile } from "@/features/profile/useProfile";
import { getDisplayName } from "@/features/dm/dmUtils";
import { Artwork } from "@/features/music/Artwork";

/** Someone's published folder (a kind-30119), as Discover lists it. */
export const PublishedFolderRow = memo(function PublishedFolderRow({
  playlist,
  onOpen,
}: {
  playlist: MusicPlaylist;
  onOpen: (addressableId: string) => void;
}) {
  const { profile } = useProfile(playlist.pubkey);
  const by = getDisplayName(profile, playlist.pubkey);
  const count = `${playlist.trackRefs.length} track${playlist.trackRefs.length !== 1 ? "s" : ""}`;
  return (
    <div className="border-b border-border-light py-1">
      <button
        type="button"
        onClick={() => onOpen(playlist.addressableId)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
      >
        <Artwork src={playlist.imageUrl} title={playlist.title} compact className="h-10 w-10 rounded-md" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-heading">{playlist.title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted">by {by}</span>
        </span>
        <span className="readout shrink-0 text-[10px] text-faint">{count}</span>
      </button>
    </div>
  );
});
