import { useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Hash } from "lucide-react-native";
import { View } from "react-native";

import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { SpacesStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<SpacesStackParamList, "Channel">;

type ChannelView = "chat" | "notes" | "media";

export function ChannelScreen({ navigation, route }: Props) {
  // Cross-cutting screens live on the root stack (typed via RootParamList).
  const rootNavigation = useNavigation();
  const [view, setView] = useState<ChannelView>("chat");

  return (
    <PlaceholderScreen
      icon={Hash}
      title="Channel"
      description="Chat, notes and media views port here from ChannelPanel."
      detail={`${route.params.spaceId} · ${route.params.channelId}`}
    >
      <View className="px-2 pb-1">
        <SegmentedControl<ChannelView>
          options={[
            { value: "chat", label: "chat" },
            { value: "notes", label: "notes" },
            { value: "media", label: "media" },
          ]}
          value={view}
          onChange={setView}
        />
      </View>
      <Button
        variant="secondary"
        onPress={() =>
          navigation.navigate("Thread", {
            spaceId: route.params.spaceId,
            channelId: route.params.channelId,
            rootEventId: "demo-event",
          })
        }
      >
        Open a thread
      </Button>
      <Button
        variant="ghost"
        onPress={() => rootNavigation.navigate("Profile", { pubkey: "demo-pubkey" })}
      >
        View a profile
      </Button>
    </PlaceholderScreen>
  );
}
