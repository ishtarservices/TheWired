// A "live now" row — voice room / listen-together session. Currently only
// exercised by tests (selectLiveItems returns [] until those features land),
// but the treatment is fixed: hairline-bordered card, participant names in
// the protocol voice, and a primary-filled join pill — the screen's one
// inversion when present.

import { Pressable, StyleSheet, View } from "react-native";

import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";
import { channelIcon } from "../channelMeta";
import type { LiveItem } from "../liveItems";

export function LiveNowRow({
  item,
  participantNames,
  onJoin,
}: {
  item: LiveItem;
  participantNames: string[];
  onJoin: () => void;
}) {
  const { tokens } = useTheme();
  const Icon = channelIcon(item.kind === "voice" ? "voice" : "music");

  return (
    <View
      className="mx-3 my-1.5 flex-row items-center gap-3 rounded-2xl px-3.5 py-3"
      style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border }}
    >
      <Icon size={18} color={tokens.heading} strokeWidth={1.75} />
      <View className="flex-1">
        <Type role="body" weight={500} numberOfLines={1} className="text-heading">
          {item.label}
        </Type>
        {participantNames.length > 0 ? (
          <Type role="meta" numberOfLines={1} className="mt-0.5 text-muted">
            {participantNames.join(", ")}
          </Type>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Join ${item.label}`}
        onPress={() => {
          haptics.tap();
          onJoin();
        }}
        className="rounded-full bg-primary px-4 py-1.5 active:opacity-90"
      >
        <Type role="caption" weight={600} className="text-primary-fg">
          join
        </Type>
      </Pressable>
    </View>
  );
}
