import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/ui/Button";
import type { RootStackParamList } from "@/navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "MediaLightbox">;

// Full-screen takeover (headerless) — pinch/zoom + swipeable gallery come with
// the media phase; foundation proves the presentation + dismissal path.

export function MediaLightboxScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Text className="text-lg font-semibold text-heading">Media Lightbox</Text>
      <Text className="mt-2 text-center text-sm text-soft">
        {route.params.srcs.length} item(s), starting at {route.params.startIndex ?? 0}
      </Text>
      <Button className="mt-6" variant="secondary" onPress={() => navigation.goBack()}>
        Close
      </Button>
    </View>
  );
}
