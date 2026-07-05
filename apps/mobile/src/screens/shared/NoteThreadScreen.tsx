import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "NoteThread">;

export function NoteThreadScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Note Thread"
      description="Deep-link target for nostr:note/nevent."
      detail={`noteId: ${route.params.noteId}`}
    />
  );
}
