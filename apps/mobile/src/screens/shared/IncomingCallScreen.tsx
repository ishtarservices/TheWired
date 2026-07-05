import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type { RootStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "IncomingCall">;

// Full-screen call UI — CallKit/ConnectionService drive the system surface in
// Phase 4; this is the in-app screen they hand off to.

export function IncomingCallScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Avatar pubkey={route.params.peerPubkey} name="?" size={96} />
      <Text className="text-xl font-semibold text-heading">Incoming call</Text>
      <Text className="text-sm text-muted">{route.params.peerPubkey}</Text>
      <View className="mt-8 w-full flex-row justify-center gap-4">
        <Button variant="destructive" className="flex-1" onPress={() => navigation.goBack()}>
          Decline
        </Button>
        <Button variant="primary" className="flex-1" onPress={() => navigation.goBack()}>
          Accept
        </Button>
      </View>
    </View>
  );
}
