import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
import { truncateKey } from "@/auth/keys";
import type { RootStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "IncomingCall">;

// Full-screen call UI — CallKit/ConnectionService drive the system surface in
// Phase 4; this is the in-app screen they hand off to.

export function IncomingCallScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom + 24 }}
    >
      <View className="flex-1 items-center justify-center">
        <Avatar pubkey={route.params.peerPubkey} name="?" size={96} />
        <Type role="title" className="mt-6 text-heading">
          Incoming call
        </Type>
        <Type role="mono" className="mt-2 text-muted">
          {truncateKey(route.params.peerPubkey)}
        </Type>
      </View>
      <View className="w-full flex-row justify-center gap-4">
        <Button size="lg" variant="destructive" className="flex-1" onPress={() => navigation.goBack()}>
          Decline
        </Button>
        <Button size="lg" variant="primary" className="flex-1" onPress={() => navigation.goBack()}>
          Accept
        </Button>
      </View>
    </View>
  );
}
