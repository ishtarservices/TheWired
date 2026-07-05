import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MessagesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<MessagesStackParamList, "DMConversation">;

export function DMConversationScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Conversation"
      description="NIP-17 conversation — swipe-to-reply, long-press action sheet."
      detail={`peer: ${route.params.pubkey}`}
    />
  );
}
