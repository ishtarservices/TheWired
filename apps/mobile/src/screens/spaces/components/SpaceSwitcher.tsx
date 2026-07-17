// The horizontal space switcher at the top of SpacesHome — replaces the W7
// vertical rail. Circle order: feed (global notes) → discover → joined
// spaces. Active space = 1.5pt primary ring; inactive items sit at reduced
// opacity with protocol-voice labels underneath. Pure props — the screen
// owns selection state and persistence.

import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { Antenna, Compass } from "lucide-react-native";
import type { LucideProps } from "lucide-react-native";
import type { ComponentType } from "react";

import { Avatar } from "@/components/ui/Avatar";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";
import type { MySpace } from "@/lib/api/spaces";
import type { SpaceSelection } from "../spacesSelection";

const CIRCLE = 46;
const ITEM_WIDTH = 64;
const RING_WIDTH = 1.5;
const RING_GAP = 2;

type SwitcherItem =
  | { kind: "feed" }
  | { kind: "discover" }
  | { kind: "space"; space: MySpace };

function itemKey(item: SwitcherItem): string {
  return item.kind === "space" ? `space-${item.space.id}` : item.kind;
}

function IconCircle({
  icon: Icon,
  dashed,
  selected,
}: {
  icon: ComponentType<LucideProps>;
  dashed?: boolean;
  selected?: boolean;
}) {
  const { tokens } = useTheme();
  return (
    <View
      className="items-center justify-center rounded-full"
      style={{
        width: CIRCLE,
        height: CIRCLE,
        // iOS can't dash a hairline — dashed borders need >= 1pt.
        borderWidth: dashed ? 1 : StyleSheet.hairlineWidth,
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: selected ? tokens.primary : tokens.border,
      }}
    >
      <Icon
        size={19}
        color={selected ? tokens.heading : tokens.muted}
        strokeWidth={selected ? 2 : 1.75}
      />
    </View>
  );
}

export function SpaceSwitcher({
  spaces,
  selection,
  onSelectFeed,
  onSelectSpace,
  onDiscover,
}: {
  spaces: MySpace[];
  selection: SpaceSelection;
  onSelectFeed: () => void;
  onSelectSpace: (spaceId: string) => void;
  onDiscover: () => void;
}) {
  const { tokens } = useTheme();
  const items: SwitcherItem[] = [
    { kind: "feed" },
    { kind: "discover" },
    ...spaces.map((space) => ({ kind: "space" as const, space })),
  ];

  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={itemKey}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}
      renderItem={({ item }) => {
        if (item.kind === "feed") {
          const selected = selection.kind === "feed";
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Global feed"
              accessibilityState={{ selected }}
              onPress={() => {
                haptics.selection();
                onSelectFeed();
              }}
              className="items-center gap-1.5 active:opacity-80"
              style={{ width: ITEM_WIDTH, opacity: selected ? 1 : 0.75 }}
            >
              <IconCircle icon={Antenna} selected={selected} />
              <Type role="meta" numberOfLines={1} className="lowercase text-muted">
                feed
              </Type>
            </Pressable>
          );
        }

        if (item.kind === "discover") {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Discover spaces"
              onPress={() => {
                haptics.selection();
                onDiscover();
              }}
              className="items-center gap-1.5 active:opacity-80"
              style={{ width: ITEM_WIDTH, opacity: 0.75 }}
            >
              <IconCircle icon={Compass} dashed />
              <Type role="meta" numberOfLines={1} className="lowercase text-muted">
                discover
              </Type>
            </Pressable>
          );
        }

        const { space } = item;
        const selected = selection.kind === "space" && selection.spaceId === space.id;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={space.name}
            accessibilityState={{ selected }}
            onPress={() => {
              haptics.selection();
              onSelectSpace(space.id);
            }}
            className="items-center gap-1.5 active:opacity-80"
            style={{ width: ITEM_WIDTH }}
          >
            <View
              className="items-center justify-center rounded-full"
              style={{
                width: CIRCLE,
                height: CIRCLE,
                borderWidth: RING_WIDTH,
                borderColor: selected ? tokens.primary : "transparent",
                opacity: selected ? 1 : 0.65,
              }}
            >
              <Avatar
                uri={space.picture}
                name={space.name}
                pubkey={space.id}
                size={CIRCLE - (RING_WIDTH + RING_GAP) * 2}
              />
            </View>
            <Type
              role="meta"
              numberOfLines={1}
              className="lowercase"
              style={{ color: selected ? tokens.soft : tokens.muted }}
            >
              {space.name.toLowerCase()}
            </Type>
          </Pressable>
        );
      }}
    />
  );
}
