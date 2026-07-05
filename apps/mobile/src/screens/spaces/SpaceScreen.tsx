import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Button } from "@/components/ui/Button";
import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "Space">;

export function SpaceScreen({ navigation, route }: Props) {
  return (
    <PlaceholderScreen
      title="Space"
      description="Channel list + space header — ports SpaceView/ChannelList. Members/Info move to a bottom sheet."
      detail={`spaceId: ${route.params.spaceId}`}
    >
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("Channel", {
            spaceId: route.params.spaceId,
            channelId: "general",
          })
        }
      >
        Open #general →
      </Button>
    </PlaceholderScreen>
  );
}
