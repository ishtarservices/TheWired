import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { goBack as stepOut } from "@/store/slices/musicSlice";
import { describeEntry, isMusicDetail, useNavigationTrail } from "@/hooks/useNavigationHistory";

/**
 * The Back control on a music detail page.
 *
 * It goes to the page you were actually on, the same place the top-bar arrow
 * goes, and says where that is: "Back to Explore", "Back to Discover". A
 * project opened from Explore is a page of Explore, so leaving it should
 * never drop you somewhere else.
 */
export function BackLink({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  const { previous, goBack } = useNavigationTrail();
  const spaceName = useAppSelector((s) =>
    previous?.spaceId ? (s.spaces.list.find((sp) => sp.id === previous.spaceId)?.name ?? null) : null,
  );

  // A project or folder is named by its title when we have it.
  const itemTitle = useAppSelector((s) => {
    if (!previous || !isMusicDetail(previous) || !previous.musicDetailId) return null;
    const id = previous.musicDetailId;
    return s.music.albums[id]?.title ?? s.music.playlists[id]?.title ?? null;
  });

  const destination = previous ? (itemTitle ?? describeEntry(previous, spaceName)) : "Home";
  const text = destination ? `Back to ${destination}` : "Back";
  // Nothing recorded behind this page (a share link opened first): step out
  // to the music section instead of doing nothing.
  const onClick = () => {
    if (!goBack()) dispatch(stepOut());
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "-ml-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-soft transition-colors hover:bg-surface-hover hover:text-heading",
        className,
      )}
    >
      <ArrowLeft size={14} />
      {text}
    </button>
  );
}
