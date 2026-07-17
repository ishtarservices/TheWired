// The music/releases channel row: name line plus a strip of recent cover-art
// thumbnails (from music events the space feed already fetched — never a new
// subscription) with a hairline "+N" overflow tile. With no artwork cached
// yet it degrades to the plain ChannelRowRich.

import { Image, StyleSheet, View } from "react-native";
import { Pressable } from "react-native";

import { Type } from "@/components/ui/Type";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { useTheme } from "@/theme/ThemeContext";
import type { SpaceChannel } from "@/lib/api/spaces";
import { channelIcon } from "../channelMeta";
import { ChannelRowRich } from "./ChannelRowRich";

const THUMB_SIZE = 32;
const MAX_THUMBS = 4;

export interface MusicChannelRowProps {
  channel: SpaceChannel;
  artworks: string[];
  onPress?: () => void;
  onLongPress?: () => void;
}

export function MusicChannelRow({
  channel,
  artworks,
  onPress,
  onLongPress,
}: MusicChannelRowProps) {
  const { tokens } = useTheme();
  const Icon = channelIcon(channel.type);
  const safe = artworks
    .map((uri) => safeImageUri(uri))
    .filter((uri): uri is string => !!uri);

  if (safe.length === 0) {
    return (
      <ChannelRowRich channel={channel} onPress={onPress} onLongPress={onLongPress} />
    );
  }

  const shown = safe.slice(0, MAX_THUMBS);
  const overflow = safe.length - shown.length;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`#${channel.label}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      className="active:bg-surface-hover"
      style={{
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: tokens.borderLight,
      }}
    >
      <View className="flex-row items-center gap-3">
        <Icon size={16} color={tokens.muted} strokeWidth={1.75} />
        <Type role="body" weight={500} numberOfLines={1} className="flex-1 text-heading">
          {channel.label}
        </Type>
      </View>
      <View className="mt-2 flex-row items-center gap-1.5" style={{ marginLeft: 28 }}>
        {shown.map((uri) => (
          <Image
            key={uri}
            source={{ uri }}
            style={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderRadius: 6,
              backgroundColor: tokens.surfaceHover,
            }}
          />
        ))}
        {overflow > 0 ? (
          <View
            className="items-center justify-center rounded-md"
            style={{
              width: THUMB_SIZE,
              height: THUMB_SIZE,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: tokens.border,
            }}
          >
            <Type role="meta" tabular className="text-muted">
              +{overflow}
            </Type>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
