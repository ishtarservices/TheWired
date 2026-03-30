import { useRef } from "react";
import { Users } from "lucide-react";
import { useAppSelector } from "@/store/hooks";
import { parseChannelIdPart } from "@/features/spaces/spaceSelectors";
import { NotesFeed } from "@/features/spaces/NotesFeed";
import { MediaFeed } from "@/features/spaces/MediaFeed";
import { LongFormView } from "@/features/longform/LongFormView";

const CHANNEL_COMPONENTS: Record<string, React.ComponentType> = {
  notes: NotesFeed,
  media: MediaFeed,
  articles: LongFormView,
};

export function FriendsFeedPanel() {
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const followCount = useAppSelector((s) => s.identity.followList.length);
  const channelIdPart = parseChannelIdPart(activeChannelId);

  // Track visited channels for keep-alive rendering
  const visitedRef = useRef(new Set<string>());
  if (channelIdPart) {
    visitedRef.current.add(channelIdPart);
  }

  if (followCount === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Users size={32} className="mx-auto mb-3 text-muted opacity-30" />
          <h3 className="text-sm font-semibold text-heading">
            No Follows Yet
          </h3>
          <p className="mt-1 text-xs text-muted max-w-sm">
            Follow people to see their notes, media, and articles here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {[...visitedRef.current].map((type) => {
        const Component = CHANNEL_COMPONENTS[type];
        if (!Component) return null;

        const isActive = type === channelIdPart;
        return (
          <div
            key={type}
            className={isActive ? "flex flex-1 overflow-hidden" : "hidden"}
          >
            <Component />
          </div>
        );
      })}
    </>
  );
}
