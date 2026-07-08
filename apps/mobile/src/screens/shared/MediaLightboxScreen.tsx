import { useCallback, useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { X } from "lucide-react-native";
import { FlatList, Image, Pressable, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Type } from "@/components/ui/Type";
import { safeImageUri } from "@/lib/nostr/noteContent";
import type { RootStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "MediaLightbox">;

// Full-screen swipeable image gallery on a literal black stage: horizontal
// paging, position counter, close. (Pinch-zoom is a later polish pass.)

export function MediaLightboxScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // Untrusted event data — drop anything that isn't a clean image URL.
  const srcs = useMemo(
    () =>
      route.params.srcs
        .map((src) => safeImageUri(src))
        .filter((src): src is string => !!src),
    [route.params.srcs],
  );
  const startIndex = Math.min(Math.max(route.params.startIndex ?? 0, 0), Math.max(srcs.length - 1, 0));
  const [index, setIndex] = useState(startIndex);

  const renderItem = useCallback(
    ({ item }: { item: string }) => (
      <View style={{ width }} className="items-center justify-center">
        <Image
          source={{ uri: item }}
          style={{ width, height: "100%" }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
    ),
    [width],
  );

  return (
    <View className="flex-1 bg-black">
      <FlatList
        data={srcs}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item, i) => `${i}-${item}`}
        renderItem={renderItem}
        initialScrollIndex={startIndex}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        onMomentumScrollEnd={(e) =>
          setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
        }
        ListEmptyComponent={
          <View style={{ width }} className="items-center justify-center">
            <Type role="caption" className="text-muted">
              Nothing to show.
            </Type>
          </View>
        }
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => navigation.goBack()}
        className="absolute right-5 h-11 w-11 items-center justify-center rounded-full bg-black/60"
        style={{ top: insets.top + 8 }}
      >
        <X size={20} color="#fff" />
      </Pressable>

      {srcs.length > 1 ? (
        <View
          className="absolute self-center rounded-full bg-black/60 px-3 py-1"
          style={{ bottom: insets.bottom + 16 }}
        >
          <Type role="micro" tabular weight={500} className="text-white">
            {index + 1} / {srcs.length}
          </Type>
        </View>
      ) : null}
    </View>
  );
}
