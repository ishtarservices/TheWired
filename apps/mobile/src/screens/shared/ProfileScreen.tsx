import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { View } from "react-native";

import { Avatar } from "@/components/ui/Avatar";
import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export function ProfileScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Profile"
      description="Live kind-0 profiles and recent notes arrive with the relay pool."
      detail={route.params.pubkey}
    >
      <View className="items-center pb-2">
        <Avatar pubkey={route.params.pubkey} name="?" size={72} />
      </View>
    </PlaceholderScreen>
  );
}
