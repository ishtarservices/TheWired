// Channel-list shaping shared by the space home pane and the full Space
// screen: category grouping (ungrouped first, position order preserved) and
// the NIP-29-native single-chat synthesis (desktop makeNativeChannels parity).

import type { SpaceChannel } from "@/lib/api/spaces";

export type ChannelListRow =
  | { kind: "category"; key: string; label: string }
  | { kind: "channel"; key: string; channel: SpaceChannel };

/** NIP-29-native spaces have no backend channels — one interoperable chat. */
export function nativeChatChannel(): SpaceChannel {
  return {
    id: "chat",
    type: "chat",
    label: "chat",
    isDefault: true,
    categoryId: null,
    position: 0,
    adminOnly: false,
    slowModeSeconds: 0,
    feedMode: "all",
  };
}

/**
 * Rows for a space's channel list. `channels === null` (still loading) yields
 * no rows; an empty list on a nip29 space synthesizes the single chat.
 */
export function buildChannelRows(
  channels: SpaceChannel[] | null,
  spaceMode: string | undefined,
): ChannelListRow[] {
  let list = channels ?? [];
  if (channels !== null && list.length === 0 && spaceMode === "nip29") {
    list = [nativeChatChannel()];
  }

  const grouped = new Map<string | null, SpaceChannel[]>();
  for (const ch of list) {
    const bucket = grouped.get(ch.categoryId);
    if (bucket) bucket.push(ch);
    else grouped.set(ch.categoryId, [ch]);
  }

  const out: ChannelListRow[] = [];
  const emit = (key: string | null, chans: SpaceChannel[]) => {
    if (key !== null) out.push({ kind: "category", key: `cat-${key}`, label: key });
    for (const ch of chans) out.push({ kind: "channel", key: ch.id, channel: ch });
  };
  const ungrouped = grouped.get(null);
  if (ungrouped) emit(null, ungrouped);
  for (const [key, chans] of grouped) {
    if (key !== null) emit(key, chans);
  }
  return out;
}
