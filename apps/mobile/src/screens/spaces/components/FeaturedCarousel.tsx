import { useCallback, useState } from "react";
import { FlatList, Image, Pressable, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Users } from "lucide-react-native";
import type { ListedSpace } from "@/lib/api/discovery";

import { Avatar } from "@/components/ui/Avatar";
import { Pill } from "@/components/ui/Pill";
import { Type } from "@/components/ui/Type";
import { useMotion } from "@/theme/motion";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { AnimatedView } from "@/lib/animated";

// Horizontal snap carousel of featured spaces: cover image + scrim + the
// essentials. Cards without a picture fall back to a tonal gradient with the
// avatar initial, so the rail never looks broken.

const GAP = 10;

function FeaturedCard({
  space,
  width,
  onPress,
}: {
  space: ListedSpace;
  width: number;
  onPress: () => void;
}) {
  const cover = safeImageUri(space.picture);
  const [pressed, setPressed] = useState(false);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${space.name}, ${space.memberCount} members`}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className="h-40 overflow-hidden rounded-2xl bg-card"
      style={[{ width }, pressed ? { opacity: 0.85 } : null]}
    >
      {cover ? (
        <Image
          source={{ uri: cover }}
          resizeMode="cover"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View className="absolute inset-0 items-center justify-center bg-primary-dim">
          <Avatar name={space.name} pubkey={space.id} size={56} />
        </View>
      )}
      {/* Literal black scrim — sits on imagery, not on a themed surface. */}
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.82)"]}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 96 }}
      />
      <View className="flex-1 justify-end p-3.5">
        <View className="flex-row items-center gap-2">
          <Type role="headline" weight={600} className="shrink text-white" numberOfLines={1}>
            {space.name}
          </Type>
          {space.featured ? <Pill label="featured" tone="primary" /> : null}
        </View>
        <View className="mt-1 flex-row items-center gap-1.5">
          <Users size={12} color="rgba(255,255,255,0.75)" />
          <Type role="micro" tabular weight={500} style={{ color: "rgba(255,255,255,0.75)" }}>
            {space.memberCount} members
          </Type>
          {space.category ? (
            <Type role="micro" className="lowercase" style={{ color: "rgba(255,255,255,0.6)" }}>
              · {space.category}
            </Type>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function FeaturedCarousel({
  spaces,
  onPressSpace,
}: {
  spaces: ListedSpace[];
  onPressSpace: (spaceId: string) => void;
}) {
  const { width } = useWindowDimensions();
  const { entering } = useMotion();
  const cardWidth = Math.min(Math.round(width * 0.72), 300);

  const renderItem = useCallback(
    ({ item, index }: { item: ListedSpace; index: number }) => (
      <AnimatedView entering={entering(index)}>
        <FeaturedCard space={item} width={cardWidth} onPress={() => onPressSpace(item.id)} />
      </AnimatedView>
    ),
    [cardWidth, onPressSpace, entering],
  );

  return (
    <FlatList
      data={spaces}
      horizontal
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      showsHorizontalScrollIndicator={false}
      snapToInterval={cardWidth + GAP}
      decelerationRate="fast"
      contentContainerStyle={{ gap: GAP, paddingVertical: 2 }}
      // The rail lives inside the screen's padded header — bleed is handled there.
    />
  );
}
