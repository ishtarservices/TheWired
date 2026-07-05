import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "JoinSpace">;

export function JoinSpaceScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Join Space"
      description="Invite acceptance sheet — deep-link target for /invite/:code."
      detail={`code: ${route.params.code}`}
    />
  );
}
