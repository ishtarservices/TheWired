// Dense bordered channel row for the grouped SpacesHome list: type icon,
// name (bright while unread / calm once read), mono relative timestamp,
// optional one-line "sender: text" preview, and a primary-filled unread pill.
// Rows with no preview data render name + chevron only and must look
// intentional — honest degradation, never placeholder text. Pure props;
// the parent list resolves store state (preview/unread/sender name).

import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Type } from "@/components/ui/Type";
import { formatRelativeTime } from "@/lib/time";
import { useTheme } from "@/theme/ThemeContext";
import type { SpaceChannel } from "@/lib/api/spaces";
import { channelIcon } from "../channelMeta";

export interface ChannelRowRichProps {
  channel: SpaceChannel;
  preview?: { lastText: string; senderName: string; lastEventAt: number };
  unreadCount?: number;
  enterable?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

const READ_NAME_OPACITY = 0.55;

export const ChannelRowRich = memo(function ChannelRowRich({
  channel,
  preview,
  unreadCount = 0,
  enterable = true,
  onPress,
  onLongPress,
}: ChannelRowRichProps) {
  const { tokens } = useTheme();
  const Icon = channelIcon(channel.type);
  const interactive = enterable && !!onPress;
  // Bright until we KNOW it's read: unread > 0, or no preview data at all.
  const calm = unreadCount === 0 && !!preview;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`#${channel.label}`}
      disabled={!interactive}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      className={interactive ? "active:bg-surface-hover" : "opacity-50"}
      style={{
        minHeight: 52,
        justifyContent: "center",
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: tokens.borderLight,
      }}
    >
      <View className="flex-row items-center gap-3">
        <Icon size={16} color={tokens.muted} strokeWidth={1.75} />
        <Type
          role="body"
          weight={500}
          numberOfLines={1}
          className="flex-1 text-heading"
          style={calm ? { opacity: READ_NAME_OPACITY } : undefined}
        >
          {channel.label}
        </Type>
        {preview ? (
          <Type role="meta" tabular className="text-faint">
            {formatRelativeTime(preview.lastEventAt)}
          </Type>
        ) : null}
        {unreadCount > 0 ? (
          <View
            className="rounded-full bg-primary px-1.5 py-0.5"
            style={{ minWidth: 20, alignItems: "center" }}
          >
            <Type role="meta" tabular className="text-primary-fg">
              {unreadCount > 99 ? "99+" : unreadCount}
            </Type>
          </View>
        ) : interactive ? (
          <ChevronRight size={15} color={tokens.faint} />
        ) : null}
      </View>
      {preview ? (
        <Type
          role="caption"
          numberOfLines={1}
          className="mt-0.5 text-soft"
          style={{ opacity: 0.55, marginLeft: 28 }}
        >
          {preview.senderName}: {preview.lastText}
        </Type>
      ) : null}
    </Pressable>
  );
});
