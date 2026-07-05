import { Disc3 } from "lucide-react-native";

import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

export function NowPlayingScreen() {
  return (
    <PlaceholderScreen
      icon={Disc3}
      title="Now Playing"
      description="Expanded player and queue — opened from the docked mini-player."
    />
  );
}
