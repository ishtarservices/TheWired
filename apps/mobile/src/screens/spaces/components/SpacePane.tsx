import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react-native";
import { Boxes } from "lucide-react-native";
import { FlatList, Pressable, View } from "react-native";
import type { SpaceChannel, SpaceDetail } from "@/lib/api/spaces";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { cachedSpaceChannels, cachedSpaceDetail } from "@/lib/api/spaceCache";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";
import { buildChannelRows, type ChannelListRow } from "../channelGroups";
import { isEnterableChannelType } from "../channelMeta";
import { ChannelRow } from "./ChannelRow";

// The main pane for a rail-selected space: compact identity header (tap →
// the full Space screen: hero, join/leave, members) + the channel list.
// Discord's channel column, one level flatter.

export function SpacePane({
  spaceId,
  paddingTop,
  paddingBottom,
  onOpenSpace,
  onOpenChannel,
}: {
  spaceId: string;
  paddingTop: number;
  paddingBottom: number;
  onOpenSpace: () => void;
  onOpenChannel: (channel: SpaceChannel) => void;
}) {
  const { tokens } = useTheme();
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [channels, setChannels] = useState<SpaceChannel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    setDetail(null);
    setChannels(null);
    cachedSpaceDetail(spaceId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Space unavailable."));
    cachedSpaceChannels(spaceId).then(setChannels).catch(() => setChannels([]));
  }, [spaceId]);

  useEffect(load, [load]);

  const rows = buildChannelRows(channels, detail?.spaceMode);

  const renderRow = useCallback(
    ({ item }: { item: ChannelListRow }) => {
      if (item.kind === "category") {
        return <SectionHeader label={item.label.toLowerCase()} className="pt-3" />;
      }
      const enterable = isEnterableChannelType(item.channel.type);
      return (
        <ChannelRow
          channel={item.channel}
          onPress={enterable ? () => onOpenChannel(item.channel) : undefined}
        />
      );
    },
    [onOpenChannel],
  );

  if (error) {
    return (
      <View className="flex-1" style={{ paddingTop, paddingBottom }}>
        <EmptyState
          icon={Boxes}
          title="Space unavailable"
          message={error}
          action={
            <Button variant="secondary" onPress={load}>
              Try again
            </Button>
          }
        />
      </View>
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.key}
      renderItem={renderRow}
      contentContainerStyle={{
        paddingTop: paddingTop + 6,
        paddingBottom: paddingBottom + 16,
        paddingHorizontal: 10,
      }}
      ListHeaderComponent={
        detail ? (
          <View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${detail.name}`}
              onPress={() => {
                haptics.selection();
                onOpenSpace();
              }}
              className="flex-row items-center gap-3 rounded-xl px-2 py-2.5 active:bg-surface-hover"
            >
              <Avatar uri={detail.picture} name={detail.name} pubkey={detail.id} size={44} />
              <View className="flex-1">
                <Type role="headline" className="text-heading" numberOfLines={1}>
                  {detail.name}
                </Type>
                <Type role="micro" tabular className="mt-0.5 text-muted" numberOfLines={1}>
                  {detail.memberCount} member{detail.memberCount === 1 ? "" : "s"}
                  {detail.activeMembers24h > 0 ? ` · ${detail.activeMembers24h} active today` : ""}
                </Type>
              </View>
              <ChevronRight size={18} color={tokens.faint} />
            </Pressable>
            {/* Category headers label their own groups — only the flat list
                needs the generic label. */}
            {rows[0]?.kind !== "category" ? (
              <SectionHeader label="channels" className="pt-2" />
            ) : null}
          </View>
        ) : (
          <View className="flex-row items-center gap-3 px-2 py-2.5">
            <SkeletonCircle size={44} />
            <View className="flex-1 gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </View>
          </View>
        )
      }
      ListEmptyComponent={
        channels === null ? (
          <View className="gap-2.5 pt-2">
            {Array.from({ length: 4 }, (_, i) => (
              <View key={i} className="flex-row items-center gap-3 rounded-xl bg-card p-3.5">
                <SkeletonCircle size={36} />
                <Skeleton className="h-3.5 w-32" />
              </View>
            ))}
          </View>
        ) : (
          <EmptyState
            icon={Boxes}
            title="No channels listed"
            message="This space hasn't published channels the app can read yet."
          />
        )
      }
    />
  );
}
