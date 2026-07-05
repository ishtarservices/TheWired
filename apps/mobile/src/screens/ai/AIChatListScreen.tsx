import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BrainCircuit } from "lucide-react-native";

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
      icon={BrainCircuit}
      title="No conversations yet"
      description="The assistant arrives with cloud and remote engines — no localhost daemons on mobile."
    >
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("AIConversation", { conversationId: "demo-conversation" })
        }
      >
        Open demo conversation
      </Button>
    </PlaceholderScreen>
  );
}
