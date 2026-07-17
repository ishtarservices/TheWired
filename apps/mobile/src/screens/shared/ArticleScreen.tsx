import { useCallback } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { BookOpen } from "lucide-react-native";

import type { RootStackParamList } from "@/navigation/types";
import { useBackFallback } from "@/navigation/useBackFallback";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Article">;

export function ArticleScreen({ route, navigation }: Props) {
  // Cold-start deep links (naddr links) mount this as a single-route state —
  // no parent, no native chevron. "Up" goes to the tabs root.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("Tabs", { screen: "SpacesTab", params: { screen: "SpacesHome" } }), [navigation]),
  );
  return (
    <PlaceholderScreen
      icon={BookOpen}
      title="Article"
      description="Long-form reading (kind 30023) — authoring stays desktop-first."
      detail={route.params.naddr}
    />
  );
}
