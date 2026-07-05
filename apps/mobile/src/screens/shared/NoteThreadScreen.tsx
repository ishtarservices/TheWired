import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessagesSquare } from "lucide-react-native";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "NoteThread">;

export function NoteThreadScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={MessagesSquare}
      title="Thread"
      description="Deep-link target for nostr:note and nevent."
      detail={route.params.noteId}
    />
  );
}
