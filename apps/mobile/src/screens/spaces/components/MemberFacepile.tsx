import { Pressable, View } from "react-native";
import { ChevronRight } from "lucide-react-native";

import { Avatar } from "@/components/ui/Avatar";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Overlapping first-N member avatars + count → the members screen. Profiles
// resolve lazily from the store (the screen backfills kind-0s).

const SHOWN = 8;

export function MemberFacepile({
  pubkeys,
  memberCount,
  onPress,
}: {
  pubkeys: string[];
  memberCount: number;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  const profiles = useAppSelector((s) => s.profiles.byPubkey);
  const shown = pubkeys.slice(0, SHOWN);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View all ${memberCount} members`}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      className="min-h-[56px] flex-row items-center rounded-xl px-3 py-2 active:bg-surface-hover"
    >
      <View className="flex-row">
        {shown.map((pubkey, i) => {
          const profile = profiles[pubkey];
          return (
            <View
              key={pubkey}
              className="rounded-full bg-background p-0.5"
              style={i > 0 ? { marginLeft: -10 } : undefined}
            >
              <Avatar uri={profile?.picture} name={profile?.name} pubkey={pubkey} size={30} />
            </View>
          );
        })}
      </View>
      <View className="ml-2.5 flex-1">
        <Type role="caption" weight={500} className="text-soft">
          {memberCount} member{memberCount === 1 ? "" : "s"}
        </Type>
      </View>
      <ChevronRight size={18} color={tokens.faint} />
    </Pressable>
  );
}
