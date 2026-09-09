import { memo } from "react";
import { ListMusic } from "lucide-react";
import type { MusicPlaylist } from "@/types/music";
import { useProfile } from "@/features/profile/useProfile";
import { getDisplayName } from "@/features/dm/dmUtils";

export const PlaylistRow = memo(function PlaylistRow({
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
    <button
      type="button"
      onClick={() => onOpen(playlist.addressableId)}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {playlist.imageUrl ? (
        <img src={playlist.imageUrl} alt="" className="h-10 w-10 rounded object-cover" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded bg-card">
          <ListMusic size={18} className="text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-heading">{playlist.title}</p>
        <p className="truncate text-xs text-soft">by {by}</p>
      </div>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">{count}</span>
    </button>
  );
});
