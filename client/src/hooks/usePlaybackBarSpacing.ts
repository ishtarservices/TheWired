import { useAppSelector } from "@/store/hooks";

/**
 * Returns conditional Tailwind classes to prevent the playback bar
 * from occluding inputs and scroll content.
 */
export function usePlaybackBarSpacing() {
  const hasTrack = useAppSelector((s) => !!s.music.player.currentTrackId);
  const barMode = useAppSelector((s) => s.music.player.barMode);
  const miniBarCorner = useAppSelector((s) => s.music.player.miniBarCorner);

  if (!hasTrack) {
    return { scrollPaddingClass: "", inputMarginClass: "" };
  }

  if (barMode === "expanded") {
    return { scrollPaddingClass: "pb-24", inputMarginClass: "mb-[76px]" };
  }

  // Mini bar — only add spacing if in a bottom corner
  if (miniBarCorner.startsWith("bottom")) {
    return { scrollPaddingClass: "pb-16", inputMarginClass: "" };
  }

  // Top corner — no bottom interference
  return { scrollPaddingClass: "", inputMarginClass: "" };
}
