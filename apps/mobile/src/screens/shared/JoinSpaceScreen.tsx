import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { DoorOpen } from "lucide-react-native";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "JoinSpace">;

export function JoinSpaceScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={DoorOpen}
      title="Join Space"
      description="Invite acceptance — deep-link target for /invite/:code."
      detail={route.params.code}
    />
  );
}
