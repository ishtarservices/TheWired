import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Hash } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "Space">;

export function SpaceScreen({ navigation, route }: Props) {
  return (
    <PlaceholderScreen
      icon={Hash}
      title="Space"
      description="Channel list and space header arrive with the spaces phase."
      detail={route.params.spaceId}
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
        Open #general
      </Button>
    </PlaceholderScreen>
  );
}
