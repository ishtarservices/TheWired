import { Image, Pressable, View } from "react-native";
import { Film } from "lucide-react-native";
import type { MediaItem } from "../mediaEventParser";

import { useTheme } from "@/theme/ThemeContext";

// Square grid tile for the media channel. Images open the lightbox; videos
// show a Film badge (poster when tagged, tonal placeholder otherwise) and
// hand off to the caller (external open until a player ships).

export function MediaGridTile({
  item,
  size,
  onPress,
  onLongPress,
}: {
  item: MediaItem;
  size: number;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { tokens } = useTheme();
  const imageUri = item.type === "image" ? item.src : item.poster;

  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={item.type === "image" ? "Open image" : "Open video"}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      className="overflow-hidden rounded-lg bg-card active:opacity-80"
      style={{ width: size, height: size }}
    >
      {imageUri ? (
        <Image
          source={{ uri: imageUri }}
          resizeMode="cover"
          style={{ width: size, height: size }}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View className="flex-1 items-center justify-center">
          <Film size={22} color={tokens.muted} strokeWidth={1.5} />
        </View>
      )}
      {item.type === "video" && imageUri ? (
        // Literal black scrim — sits on the poster, not on a themed surface.
        <View className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 p-1.5">
          <Film size={12} color="#fff" strokeWidth={2} />
        </View>
      ) : null}
    </Pressable>
  );
}
