import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Disc3 } from "lucide-react-native";

import type { MusicStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<MusicStackParamList, "Album">;

export function AlbumScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      icon={Disc3}
      title="Album"
      description="Album detail and track list."
      detail={route.params.albumRef}
    />
  );
}
