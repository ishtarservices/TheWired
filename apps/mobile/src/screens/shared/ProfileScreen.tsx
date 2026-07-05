import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { Avatar } from "@/components/ui/Avatar";
import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export function ProfileScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Profile"
      description="Cross-cutting profile screen — reachable from any tab and from nostr:npub/nprofile deep links."
      detail={`pubkey: ${route.params.pubkey}`}
    >
      <Avatar pubkey={route.params.pubkey} name="?" size={72} />
    </PlaceholderScreen>
  );
}
