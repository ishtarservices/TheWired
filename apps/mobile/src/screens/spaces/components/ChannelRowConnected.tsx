// Store-connected, memoized wrappers for the SpacesHome list rows. The
// parent (SpaceChannelList) must NOT select the previews/lastReadAt/profiles
// maps — with the space-signal sub feeding previews live, a whole-map
// subscription would re-render every row on every incoming kind-9/kind-0.
// Each wrapper selects exactly its own row's state (per-key objects and
// primitives — immer only replaces touched keys), so a preview update
// re-renders one row. Handlers passed in must be stable (W9 contract).

import { memo, useMemo } from "react";

import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import {
  selectChannelPreview,
  selectChannelUnreadCount,
  selectSpaceMusicArtwork,
} from "@/store/slices/spacePreviewsSlice";
import type { SpaceChannel } from "@/lib/api/spaces";
import type { LiveItem } from "../liveItems";
import { ChannelRowRich } from "./ChannelRowRich";
import { LiveNowRow } from "./LiveNowRow";
import { MusicChannelRow } from "./MusicChannelRow";

export interface ConnectedRowHandlers {
  onOpenChannel: (channel: SpaceChannel) => void;
  onLongPressChannel: (channel: SpaceChannel) => void;
}

export const ChannelRowConnected = memo(function ChannelRowConnected({
  spaceId,
  channel,
  enterable,
  onOpenChannel,
  onLongPressChannel,
}: {
  spaceId: string;
  channel: SpaceChannel;
  enterable: boolean;
} & ConnectedRowHandlers) {
  const preview = useAppSelector((s) => selectChannelPreview(s, spaceId, channel.id));
  const unreadCount = useAppSelector((s) =>
    selectChannelUnreadCount(s, spaceId, channel.id),
  );
  const senderProfile = useAppSelector((s) =>
    preview ? s.profiles.byPubkey[preview.lastSenderPubkey] : undefined,
  );

  const previewProp = useMemo(
    () =>
      preview
        ? {
            lastText: preview.lastText,
            senderName: profileDisplayName(senderProfile, preview.lastSenderPubkey),
            lastEventAt: preview.lastEventAt,
          }
        : undefined,
    [preview, senderProfile],
  );

  return (
    <ChannelRowRich
      channel={channel}
      enterable={enterable}
      preview={previewProp}
      unreadCount={unreadCount}
      onPress={enterable ? () => onOpenChannel(channel) : undefined}
      onLongPress={() => onLongPressChannel(channel)}
    />
  );
});

export const MusicChannelRowConnected = memo(function MusicChannelRowConnected({
  spaceId,
  channel,
  onOpenChannel,
  onLongPressChannel,
}: {
  spaceId: string;
  channel: SpaceChannel;
} & ConnectedRowHandlers) {
  const artworks = useAppSelector((s) => selectSpaceMusicArtwork(s, spaceId));
  return (
    <MusicChannelRow
      channel={channel}
      artworks={artworks}
      onPress={() => onOpenChannel(channel)}
      onLongPress={() => onLongPressChannel(channel)}
    />
  );
});

export const LiveNowRowConnected = memo(function LiveNowRowConnected({
  item,
}: {
  item: LiveItem;
}) {
  // Join to a primitive so the selector stays reference-stable — a mapped
  // array would be a fresh reference every store change. Newline is a safe
  // separator: display names are single-line.
  const namesKey = useAppSelector((s) =>
    item.participantPubkeys
      .map((pubkey) => profileDisplayName(s.profiles.byPubkey[pubkey], pubkey))
      .join("\n"),
  );
  const participantNames = useMemo(
    () => (namesKey ? namesKey.split("\n") : []),
    [namesKey],
  );
  return (
    <LiveNowRow
      item={item}
      participantNames={participantNames}
      // Unreachable until a live source exists (selectLiveItems → []);
      // voice/listen-together wire the real join here.
      onJoin={noopJoin}
    />
  );
});

function noopJoin(): void {}
