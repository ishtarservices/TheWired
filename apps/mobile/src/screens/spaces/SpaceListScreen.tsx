import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Button } from "@/components/ui/Button";
import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "SpaceList">;

export function SpaceListScreen({ navigation }: Props) {
  return (
    <PlaceholderScreen
      title="Spaces"
      description="Space list + create/join — ports the desktop SpaceList. Long-press will open the space actions sheet."
    >
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("Space", { spaceId: "demo-space" })}
      >
        Open demo space →
      </Button>
    </PlaceholderScreen>
  );
}
