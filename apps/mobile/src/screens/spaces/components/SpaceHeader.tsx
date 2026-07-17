// The selected space's header on SpacesHome: display-voice name, outlined
// mode badge (protocol voice, hairline, no fill — hidden when the mode is
// unknown), member count, and an honest presence row — an overlap stack of
// the first few members with "N active today" (space-level activity is all
// the API exposes; never claim "online").

import { Pressable, StyleSheet, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";
import type { SpaceDetail } from "@/lib/api/spaces";
import { spaceModeBadgeLabel } from "../channelMeta";
import { MemberBubble } from "./MemberBubble";

const STACK_SHOWN = 3;

export function SpaceHeader({
  detail,
  memberPubkeys,
  onOpenSpace,
}: {
  detail: SpaceDetail | null;
  memberPubkeys: string[];
  onOpenSpace: () => void;
}) {
  const { tokens } = useTheme();

  if (!detail) {
    return (
      <View className="gap-2.5 px-4 pb-4 pt-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-3.5 w-32" />
        <View className="flex-row items-center gap-2 pt-1">
          <SkeletonCircle size={22} />
          <SkeletonCircle size={22} />
          <Skeleton className="h-3 w-20" />
        </View>
      </View>
    );
  }

  const badge = spaceModeBadgeLabel(detail.spaceMode);
  const stack = memberPubkeys.slice(0, STACK_SHOWN);
  const active = detail.activeMembers24h;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${detail.name}`}
      onPress={() => {
        haptics.selection();
        onOpenSpace();
      }}
      className="px-4 pb-4 pt-2 active:opacity-90"
    >
      <View className="flex-row items-center gap-2">
        <Type
          role="title"
          weight={400}
          numberOfLines={1}
          className="flex-1 text-heading"
          style={{ fontSize: 26, lineHeight: 32, letterSpacing: -0.5 }}
        >
          {detail.name}
        </Type>
        <ChevronRight size={18} color={tokens.faint} />
      </View>

      <View className="mt-2 flex-row items-center gap-2.5">
        {badge ? (
          <View
            className="rounded-full px-2.5 py-1"
            style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border }}
          >
            <Type role="metaLabel" className="lowercase text-soft">
              {badge}
            </Type>
          </View>
        ) : null}
        <Type role="meta" tabular className="text-muted">
          {detail.memberCount} member{detail.memberCount === 1 ? "" : "s"}
        </Type>
      </View>

      {stack.length > 0 || active > 0 ? (
        <View className="mt-2.5 flex-row items-center">
          {stack.length > 0 ? (
            <View className="mr-2 flex-row">
              {stack.map((pubkey, i) => (
                <MemberBubble
                  key={pubkey}
                  pubkey={pubkey}
                  size={22}
                  overlap={i > 0 ? -8 : 0}
                />
              ))}
            </View>
          ) : null}
          {active > 0 ? (
            // activeMembers24h = distinct authors of kind-1/9 events in the
            // ROLLING last 24h (backend analyticsAggregator refreshRollingStats,
            // hourly, zeroed when idle) — "recently", not live presence; never
            // claim "online".
            <Type role="meta" tabular className="text-muted">
              {active} active recently
            </Type>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}
