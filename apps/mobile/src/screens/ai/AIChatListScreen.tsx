import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Button } from "@/components/ui/Button";
import type { AIStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<AIStackParamList, "AIChatList">;

export function AIChatListScreen({ navigation }: Props) {
  return (
    <PlaceholderScreen
      title="AI"
      description="Conversation list. Mobile uses cloud keys / NIP-46-style remote engines only — no localhost daemons (guide 00)."
    >
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("AIConversation", { conversationId: "demo-conversation" })
        }
      >
        Open demo conversation →
      </Button>
    </PlaceholderScreen>
  );
}
