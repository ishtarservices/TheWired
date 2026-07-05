import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "Thread">;

export function ThreadScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Thread"
      description="Note thread with replies."
      detail={`rootEventId: ${route.params.rootEventId}`}
    />
  );
}
