import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Button } from "@/components/ui/Button";
import type { MusicStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<MusicStackParamList, "MusicHome">;

export function MusicHomeScreen({ navigation }: Props) {
  // Root-stack screens (modals) bubble up past this tab's stack — typed via
  // the global RootParamList declaration in navigation/types.ts.
  const rootNavigation = useNavigation();
  return (
    <PlaceholderScreen
      title="Music"
      description="Library / explore / favorites — ports MusicSidebar + MusicRouter. Playback runs on react-native-track-player in Phase 4."
    >
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("Album", { albumRef: "demo-album" })}
      >
        Open demo album →
      </Button>
      <Button variant="ghost" onPress={() => rootNavigation.navigate("NowPlaying")}>
        Now Playing (modal)
      </Button>
    </PlaceholderScreen>
  );
}
