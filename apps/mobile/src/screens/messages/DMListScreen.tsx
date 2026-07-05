import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Button } from "@/components/ui/Button";
import type { MessagesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<MessagesStackParamList, "DMList">;

export function DMListScreen({ navigation }: Props) {
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
