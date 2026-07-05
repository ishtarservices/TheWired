import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BrainCircuit } from "lucide-react-native";

import type { AIStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<AIStackParamList, "AIConversation">;

export function AIConversationScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={BrainCircuit}
      title="AI Conversation"
      description="Streaming chat ports here from AIChatView."
      detail={route.params.conversationId}
    />
  );
}
