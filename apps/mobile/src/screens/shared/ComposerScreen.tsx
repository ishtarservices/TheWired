import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Composer">;

export function ComposerScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Compose"
      description="Note/reply/quote composer sheet — native pickers replace drop zones."
      detail={`mode: ${route.params?.mode ?? "note"}`}
    />
  );
}
