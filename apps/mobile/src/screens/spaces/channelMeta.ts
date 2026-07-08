// Channel-type presentation map — mirrors the desktop CHANNEL_ICONS
// (client/src/features/spaces/ChannelList.tsx) plus mobile row subtitles.

import {
  BookOpen,
  FileText,
  Hash,
  Headphones,
  Image as ImageIcon,
  MessageSquare,
  Music,
  Video,
} from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import type { ComponentType } from "react";

const CHANNEL_ICONS: Record<string, ComponentType<LucideProps>> = {
  chat: MessageSquare,
  notes: FileText,
  media: ImageIcon,
  articles: BookOpen,
  music: Music,
  voice: Headphones,
  video: Video,
};

export function channelIcon(type: string): ComponentType<LucideProps> {
  return CHANNEL_ICONS[type] ?? Hash;
}

const SUBTITLES: Record<string, string> = {
  chat: "live chat",
  notes: "member notes",
  media: "photos & videos",
  articles: "long-form posts",
  music: "tracks & albums",
  voice: "voice room",
  video: "video room",
};

export function channelSubtitle(
  type: string,
  options: { slowModeSeconds?: number } = {},
): string {
  const base = SUBTITLES[type] ?? type;
  if (type === "chat" && (options.slowModeSeconds ?? 0) > 0) {
    return `${base} · slow mode ${options.slowModeSeconds}s`;
  }
  return base;
}

/** Channel types the app can open this pass (chat + the four feed types). */
export function isEnterableChannelType(type: string): boolean {
  return type === "chat" || type === "notes" || type === "media" || type === "articles" || type === "music";
}
