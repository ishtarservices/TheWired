import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";

import type { RootStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "VideoPlayer">;

// Full-screen video takeover (expo-video): native transport controls,
// auto-play, contain fit on a literal black stage. Sources are https-only
// (mediaEventParser sanitizes before anything navigates here).

export function VideoPlayerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(route.params.src, (p) => {
    p.play();
  });

  return (
    <View className="flex-1 bg-black">
      <VideoView
        player={player}
        style={{ flex: 1 }}
        contentFit="contain"
        nativeControls
        accessibilityLabel="Video player"
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
    </View>
  );
}
