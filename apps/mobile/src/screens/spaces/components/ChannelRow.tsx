import { View } from "react-native";
import type { SpaceChannel } from "@/lib/api/spaces";

import { ListRow } from "@/components/ui/ListRow";
import { Type } from "@/components/ui/Type";
import { channelIcon, channelSubtitle, isEnterableChannelType } from "../channelMeta";
import { useTheme } from "@/theme/ThemeContext";

// One channel entry on the space home: type icon in a tonal tile, #label,
// what-lives-here subtitle, home-channel dot. Desktop's ChannelList row,
// re-cut for touch.

export function ChannelRow({
  channel,
  onPress,
}: {
  channel: SpaceChannel;
  onPress?: () => void;
}) {
  const { tokens } = useTheme();
  const Icon = channelIcon(channel.type);
  const enterable = isEnterableChannelType(channel.type) && !!onPress;

  return (
    <ListRow
      title={`#${channel.label}`}
      subtitle={
        enterable
          ? channelSubtitle(channel.type, { slowModeSeconds: channel.slowModeSeconds })
          : `${channelSubtitle(channel.type)} · arrives in a later phase`
      }
      leading={
        <View className="h-10 w-10 items-center justify-center rounded-lg bg-surface">
          <Icon size={18} color={enterable ? tokens.primary : tokens.faint} strokeWidth={1.75} />
        </View>
      }
      trailing={
        channel.isDefault ? (
          <Type role="micro" weight={500} className="text-faint">
            home
          </Type>
        ) : undefined
      }
      onPress={enterable ? onPress : undefined}
      className={enterable ? "rounded-xl px-3" : "rounded-xl px-3 opacity-50"}
    />
  );
}
