import { useAppSelector } from "@/store/hooks";
import type { MusicVisibility } from "@/types/music";

/**
 * Marks a release that only exists inside a space. Names the space when the
 * viewer is in it; says "Space" otherwise. Renders nothing for public,
 * private and local releases, and nothing on that space's own shelf.
 */
export function SpaceTag({
  visibility,
  spaceIds,
}: {
  visibility: MusicVisibility;
  spaceIds?: string[];
}) {
  const isSpace = visibility === "space";
  const name = useAppSelector((s) => {
    if (!isSpace || !spaceIds?.length) return undefined;
    for (const id of spaceIds) {
      const space = s.spaces.list.find((sp) => sp.id === id);
      if (space) return space.name;
    }
    return undefined;
  });
  // Inside that space the tag would repeat on every card of its own shelf.
  const viewingThatSpace = useAppSelector(
    (s) =>
      isSpace &&
      s.ui.sidebarMode === "spaces" &&
      !!s.spaces.activeSpaceId &&
      !!spaceIds?.includes(s.spaces.activeSpaceId),
  );
  if (!isSpace || viewingThatSpace) return null;
  const more = spaceIds && spaceIds.length > 1 ? ` +${spaceIds.length - 1}` : "";
  return (
    <span
      title={name ? `Only in ${name}${more ? ` and ${spaceIds!.length - 1} more` : ""}` : "Only in a space"}
      className="min-w-0 max-w-[7.5rem] shrink truncate font-mono text-[9px] uppercase tracking-wider text-faint"
    >
      {name ?? "Space"}
      {more}
    </span>
  );
}
