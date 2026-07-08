import { Pressable, ScrollView, View } from "react-native";
import { Antenna, Compass } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import type { ComponentType } from "react";
import type { MySpace } from "@/lib/api/spaces";

import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/cn";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";

// The joined-spaces side rail (Discord's server column; desktop's SpaceList
// sidebar): Feed entry on top, joined space avatars, Discover at the end.
// Selection = primary ring; everything else stays calm.

export type RailSelection = { kind: "feed" } | { kind: "space"; spaceId: string };

function RailIconButton({
  icon: Icon,
  label,
  selected,
  onPress,
}: {
  icon: ComponentType<LucideProps>;
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      onPress={onPress}
      className={cn(
        "h-12 w-12 items-center justify-center rounded-full active:opacity-80",
        selected ? "bg-primary-dim" : "bg-surface",
      )}
    >
      <Icon
        size={20}
        color={selected ? tokens.primarySoft : tokens.muted}
        strokeWidth={selected ? 2.25 : 1.75}
      />
    </Pressable>
  );
}

function RailDivider() {
  return <View className="h-px w-8 self-center rounded-full bg-border-light" />;
}

export function SpaceRail({
  spaces,
  selection,
  onSelectFeed,
  onSelectSpace,
  onDiscover,
  paddingTop,
  paddingBottom,
}: {
  spaces: MySpace[];
  selection: RailSelection;
  onSelectFeed: () => void;
  onSelectSpace: (spaceId: string) => void;
  onDiscover: () => void;
  paddingTop: number;
  paddingBottom: number;
}) {
  return (
    <View className="w-[68px] bg-panel">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: paddingTop + 10,
          paddingBottom: paddingBottom + 10,
          alignItems: "center",
          gap: 12,
        }}
      >
        <RailIconButton
          icon={Antenna}
          label="Global feed"
          selected={selection.kind === "feed"}
          onPress={() => {
            haptics.selection();
            onSelectFeed();
          }}
        />

        {spaces.length > 0 ? <RailDivider /> : null}

        {spaces.map((space) => {
          const selected = selection.kind === "space" && selection.spaceId === space.id;
          return (
            <Pressable
              key={space.id}
              accessibilityRole="button"
              accessibilityLabel={space.name}
              accessibilityState={{ selected }}
              onPress={() => {
                haptics.selection();
                onSelectSpace(space.id);
              }}
              className={cn(
                "rounded-full border-2 p-0.5 active:opacity-80",
                selected ? "border-primary" : "border-transparent opacity-80",
              )}
            >
              <Avatar uri={space.picture} name={space.name} pubkey={space.id} size={44} />
            </Pressable>
          );
        })}

        <RailDivider />

        <RailIconButton icon={Compass} label="Discover spaces" onPress={onDiscover} />
      </ScrollView>
    </View>
  );
}
