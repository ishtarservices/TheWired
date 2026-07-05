import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Type } from "@/components/ui/Type";
import type { RootStackParamList } from "@/navigation/types";
import { useTheme } from "@/theme/ThemeContext";

type Props = NativeStackScreenProps<RootStackParamList, "MediaLightbox">;

// Full-screen takeover (headerless) — pinch/zoom + swipeable gallery come with
// the media phase; foundation proves the presentation + dismissal path.

export function MediaLightboxScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { tokens } = useTheme();
  return (
    <View
      className="flex-1 items-center justify-center bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={() => navigation.goBack()}
        className="absolute right-5 h-11 w-11 items-center justify-center rounded-full bg-surface-hover"
        style={{ top: insets.top + 8 }}
      >
        <X size={20} color={tokens.soft} />
      </Pressable>
      <Type role="headline" className="text-heading">
        Media
      </Type>
      <Type role="caption" className="mt-2 text-center text-muted">
        {route.params.srcs.length} item(s), starting at {route.params.startIndex ?? 0}
      </Type>
    </View>
  );
}
