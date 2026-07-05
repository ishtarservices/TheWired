import type { NativeStackScreenProps } from "@react-navigation/native-stack";

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
      title="Messages"
      description="NIP-17 DM contact list — ports DMSidebar. Backgrounded delivery moves to push (Phase 3)."
    >
      <Button
        variant="secondary"
        onPress={() => navigation.navigate("DMConversation", { pubkey: "demo-pubkey" })}
      >
        Open demo conversation →
      </Button>
    </PlaceholderScreen>
  );
}
