import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessagesSquare } from "lucide-react-native";

import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "Thread">;

export function ThreadScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={MessagesSquare}
      title="Thread"
      description="Replies thread under a channel message."
      detail={route.params.rootEventId}
    />
  );
}
