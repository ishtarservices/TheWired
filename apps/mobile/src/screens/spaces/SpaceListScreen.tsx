import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Boxes } from "lucide-react-native";

import { Button } from "@/components/ui/Button";
import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "SpaceList">;

export function SpaceListScreen({ navigation }: Props) {
  return (
    <PlaceholderScreen
      icon={Boxes}
      title="Spaces"
      description="The live feed and space directory land here next (W2)."
    >
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("Space", { spaceId: "demo-space" })}
      >
        Open demo space
      </Button>
    </PlaceholderScreen>
  );
}
