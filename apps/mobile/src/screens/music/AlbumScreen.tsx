import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import type { MusicStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";

type Props = NativeStackScreenProps<MusicStackParamList, "Album">;

export function AlbumScreen({ route }: Props) {
  return (
    <PlaceholderScreen
      title="Album"
      description="Album detail + track list."
      detail={`albumRef: ${route.params.albumRef}`}
    />
  );
}
