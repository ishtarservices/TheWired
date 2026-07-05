import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Article">;

export function ArticleScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Article"
      description="Long-form reading (kind 30023) — authoring stays desktop-first."
      detail={`naddr: ${route.params.naddr}`}
    />
  );
}
