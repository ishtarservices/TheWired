// SpacesHome channel grouping — by TYPE into fixed sections (live now →
// text → music → feeds), unlike channelGroups.ts which groups by categoryId
// for the full Space screen (both stay: different surfaces, different
// grouping). Section headers render only for non-empty buckets; input order
// (position-sorted by parseSpaceChannels) is preserved within buckets.

import type { SpaceChannel } from "@/lib/api/spaces";
import { nativeChatChannel } from "./channelGroups";
import { isEnterableChannelType } from "./channelMeta";
import type { LiveItem } from "./liveItems";

export type SectionLabel = "live now" | "text" | "music" | "feeds";

export type SectionRow =
  | { kind: "header"; key: string; label: SectionLabel }
  | { kind: "live"; key: string; item: LiveItem }
  | { kind: "channel"; key: string; channel: SpaceChannel; enterable: boolean }
  | { kind: "musicChannel"; key: string; channel: SpaceChannel };

/**
 * Rows for the grouped home list. `channels === null` (loading) yields no
 * rows; an empty list on a nip29 space synthesizes the single native chat.
 * Unknown/future channel types (voice, video, …) land in `feeds` as
 * non-enterable rows rather than disappearing.
 */
export function buildChannelSections(
  channels: SpaceChannel[] | null,
  spaceMode: string | undefined,
  liveItems: LiveItem[],
): SectionRow[] {
  if (channels === null) return [];
  let list = channels;
  if (list.length === 0 && spaceMode === "nip29") {
    list = [nativeChatChannel()];
  }

  const text: SpaceChannel[] = [];
  const music: SpaceChannel[] = [];
  const feeds: SpaceChannel[] = [];
  for (const ch of list) {
    if (ch.type === "chat") text.push(ch);
    else if (ch.type === "music") music.push(ch);
    else feeds.push(ch);
  }

  const out: SectionRow[] = [];

  if (liveItems.length > 0) {
    out.push({ kind: "header", key: "hdr-live", label: "live now" });
    for (const item of liveItems) {
      out.push({ kind: "live", key: `live-${item.id}`, item });
    }
  }

  if (text.length > 0) {
    out.push({ kind: "header", key: "hdr-text", label: "text" });
    for (const ch of text) {
      out.push({ kind: "channel", key: ch.id, channel: ch, enterable: true });
    }
  }

  if (music.length > 0) {
    out.push({ kind: "header", key: "hdr-music", label: "music" });
    for (const ch of music) {
      out.push({ kind: "musicChannel", key: ch.id, channel: ch });
    }
  }

  if (feeds.length > 0) {
    out.push({ kind: "header", key: "hdr-feeds", label: "feeds" });
    for (const ch of feeds) {
      out.push({
        kind: "channel",
        key: ch.id,
        channel: ch,
        enterable: isEnterableChannelType(ch.type),
      });
    }
  }

  return out;
}
