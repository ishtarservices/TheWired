import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Music } from "lucide-react-native";

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
      icon={Music}
      title="Music"
      description="Library, explore and favorites arrive with the music phase."
    >
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("Album", { albumRef: "demo-album" })}
      >
        Open demo album
      </Button>
      <Button variant="ghost" onPress={() => rootNavigation.navigate("NowPlaying")}>
        Now Playing
      </Button>
    </PlaceholderScreen>
  );
}
