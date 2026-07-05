import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { PenLine } from "lucide-react-native";

import type { RootStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<RootStackParamList, "Composer">;

export function ComposerScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={PenLine}
      title="Compose"
      description="The note composer goes live with the relay pool (W2)."
      detail={route.params?.mode ?? "note"}
    />
  );
}
