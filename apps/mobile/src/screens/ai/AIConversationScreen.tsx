import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { AIStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<AIStackParamList, "AIConversation">;

export function AIConversationScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="AI Conversation"
      description="Streaming chat — ports AIChatView; artifacts render via victory-native."
      detail={`conversationId: ${route.params.conversationId}`}
    />
  );
}
