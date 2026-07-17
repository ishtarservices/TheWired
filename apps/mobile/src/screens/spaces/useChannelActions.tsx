// Long-press quick actions for a channel row on SpacesHome (useNoteActions
// pattern — one sheet instance per screen):
//
//   const channelActions = useChannelActions(spaceId);
//   <ChannelRowRich onLongPress={() => channelActions.open(channel)} />
//   {channelActions.sheet}
//
// Mute space/channel have no backend or slice support yet — they render
// disabled with an honest sublabel rather than silently no-oping.

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import * as Clipboard from "expo-clipboard";
import { BellOff, Check, Link2 } from "lucide-react-native";

import { ActionsSheet, type ActionsSheetRef } from "@/components/ui/ActionsSheet";
import { haptics } from "@/lib/haptics";
import { markChannelRead } from "@/store/spacePreviews";
import { useAppDispatch } from "@/store/hooks";
import type { SpaceChannel } from "@/lib/api/spaces";
import { isSpaceFeedType } from "@/lib/nostr/spaceFeedRoutes";

export interface ChannelActions {
  open: (channel: SpaceChannel) => void;
  sheet: ReactNode;
}

/** Shareable https link for a channel — mirrors navigation/linking.ts paths. */
export function channelShareUrl(spaceId: string, channel: SpaceChannel): string | null {
  const space = encodeURIComponent(spaceId);
  const id = encodeURIComponent(channel.id);
  if (channel.type === "chat") {
    return `https://thewired.app/space/${space}/channel/${id}`;
  }
  if (isSpaceFeedType(channel.type)) {
    return `https://thewired.app/space/${space}/feed/${channel.type}/${id}?label=${encodeURIComponent(channel.label)}`;
  }
  return null;
}

export function useChannelActions(spaceId: string): ChannelActions {
  const dispatch = useAppDispatch();
  const sheetRef = useRef<ActionsSheetRef>(null);
  const [channel, setChannel] = useState<SpaceChannel | null>(null);

  const open = useCallback((target: SpaceChannel) => {
    setChannel(target);
    haptics.tap();
    requestAnimationFrame(() => sheetRef.current?.present());
  }, []);

  const actions = useMemo(() => {
    if (!channel) return [];
    const shareUrl = channelShareUrl(spaceId, channel);
    return [
      {
        icon: Check,
        label: "Mark read",
        onPress: () => {
          dispatch(markChannelRead(spaceId, channel.id));
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
      {
        icon: BellOff,
        label: "Mute channel",
        sublabel: "Not available yet",
        disabled: true,
        onPress: () => {},
      },
      {
        icon: BellOff,
        label: "Mute space",
        sublabel: "Not available yet",
        disabled: true,
        onPress: () => {},
      },
      {
        icon: Link2,
        label: "Copy link",
        sublabel: shareUrl ? undefined : "This channel type has no link yet",
        disabled: !shareUrl,
        onPress: () => {
          if (!shareUrl) return;
          Clipboard.setStringAsync(shareUrl).catch(() => {});
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
    ];
  }, [channel, spaceId, dispatch]);

  return {
    open,
    sheet: (
      <ActionsSheet
        ref={sheetRef}
        title={channel ? `#${channel.label}` : undefined}
        actions={actions}
      />
    ),
  };
}
