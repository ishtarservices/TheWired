import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { SignInGate } from "@/components/auth/SignInGate";
import { Button } from "@/components/ui/Button";
import type { AIStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";
import { useAppSelector } from "@/store/hooks";

type Props = NativeStackScreenProps<AIStackParamList, "AIChatList">;

export function AIChatListScreen({ navigation }: Props) {
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  if (isGuest) {
    return (
      <SignInGate
        title="AI needs an identity"
        message="Conversations and provider settings are stored per identity, and agent write actions are signed by your key."
      />
    );
  }
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
