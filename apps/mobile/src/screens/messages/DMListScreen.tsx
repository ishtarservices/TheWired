import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessageCircle } from "lucide-react-native";

import { SignInGate } from "@/components/auth/SignInGate";
import { Button } from "@/components/ui/Button";
import type { MessagesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";
import { useAppSelector } from "@/store/hooks";

type Props = NativeStackScreenProps<MessagesStackParamList, "DMList">;

export function DMListScreen({ navigation }: Props) {
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  if (isGuest) {
    return (
      <SignInGate
        title="Messages need an identity"
        message="Direct messages are encrypted to your key (NIP-17) — there's nothing to read or send without one."
      />
    );
  }
  return (
    <PlaceholderScreen
      icon={MessageCircle}
      title="No messages yet"
      description="Encrypted conversations (NIP-17) arrive with the DM phase."
    >
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("DMConversation", { pubkey: "demo-pubkey" })}
      >
        Open demo conversation
      </Button>
    </PlaceholderScreen>
  );
}
