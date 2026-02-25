import { useRef } from "react";
import { useAppSelector } from "../../store/hooks";
import { ChatView } from "../chat/ChatView";
import { ReelsView } from "../media/ReelsView";
import { LongFormView } from "../longform/LongFormView";
import { NotesFeed } from "./NotesFeed";
import { MediaFeed } from "./MediaFeed";
import { SpaceMusicView } from "../music/SpaceMusicView";

/**
 * Keep-alive channel panel.
 *
 * Instead of conditional rendering (which destroys & recreates DOM on every
 * channel switch), this component mounts all visited channel views and uses
 * CSS `display: none` to hide inactive ones. This means:
 *
 * - DOM elements (including decoded images) survive channel switches
 * - Scroll positions are preserved natively
 * - Component state (expanded items, filter tabs, etc.) persists
 * - No image re-decode flash when switching back to a channel
 *
 * Views are lazily activated: a channel view only mounts after the user visits
 * it for the first time, keeping initial render lightweight.
 */

const CHANNEL_COMPONENTS: Record<string, React.ComponentType> = {
  chat: ChatView,
  notes: NotesFeed,
  media: MediaFeed,
  articles: LongFormView,
  reels: ReelsView,
  "long-form": LongFormView,
  music: SpaceMusicView,
};

export function ChannelPanel() {
  const activeChannelId = useAppSelector((s) => s.spaces.activeChannelId);
  const activeSpaceId = useAppSelector((s) => s.spaces.activeSpaceId);
  const channels = useAppSelector(
    (s) => (activeSpaceId ? s.spaces.channels[activeSpaceId] : undefined) ?? [],
  );

  // Resolve channel type from channel ID
  const channelIdPart = activeChannelId?.split(":").slice(1).join(":") ?? "";
  const channel = channels.find((c) => c.id === channelIdPart);
  const channelType = channel?.type ?? channelIdPart; // Legacy fallback

  // Track which channels have been visited so we can lazily mount them
  const visitedRef = useRef(new Set<string>());
  if (channelType) {
    visitedRef.current.add(channelType);
  }

  return (
    <>
      {[...visitedRef.current].map((type) => {
        const Component = CHANNEL_COMPONENTS[type];
        if (!Component) return null;

        const isActive = type === channelType;

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
