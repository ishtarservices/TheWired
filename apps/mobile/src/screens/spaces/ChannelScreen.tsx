import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Button } from "@/components/ui/Button";
import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "Channel">;

export function ChannelScreen({ navigation, route }: Props) {
  // Cross-cutting screens live on the root stack (typed via RootParamList).
  const rootNavigation = useNavigation();
  return (
    <PlaceholderScreen
      title="Channel"
      description="Ports ChannelPanel — a segmented control replaces the chat/notes/media/reels sub-tabs."
      detail={`spaceId: ${route.params.spaceId} · channelId: ${route.params.channelId}`}
    >
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("Thread", {
            spaceId: route.params.spaceId,
            channelId: route.params.channelId,
            rootEventId: "demo-event",
          })
        }
      >
        Open a thread →
      </Button>
      <Button
        variant="ghost"
        onPress={() => rootNavigation.navigate("Profile", { pubkey: "demo-pubkey" })}
      >
        View a profile (root push)
      </Button>
    </PlaceholderScreen>
  );
}
