import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessageCircle } from "lucide-react-native";

import type { MessagesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<MessagesStackParamList, "DMConversation">;

export function DMConversationScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={MessageCircle}
      title="Conversation"
      description="NIP-17 conversation with swipe-to-reply."
      detail={route.params.pubkey}
    />
  );
}
