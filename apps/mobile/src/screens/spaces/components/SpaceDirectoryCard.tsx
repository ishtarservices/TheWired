import { View } from "react-native";
import { Users } from "lucide-react-native";
import type { ListedSpace } from "@/lib/api/discovery";

import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Type } from "@/components/ui/Type";
import { useTheme } from "@/theme/ThemeContext";

// One directory row: identity + about + the numbers that make a space feel
// alive (members, active today, category).

export function SpaceDirectoryCard({
  space,
  onPress,
}: {
  space: ListedSpace;
  onPress: () => void;
}) {
  const { tokens } = useTheme();
  return (
    <Card onPress={onPress} className="flex-row items-center gap-3">
      <Avatar uri={space.picture} name={space.name} pubkey={space.id} size={48} />
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Type role="body" weight={600} className="shrink text-heading" numberOfLines={1}>
            {space.name}
          </Type>
          {space.featured ? <Pill label="featured" tone="primary" /> : null}
        </View>
        {space.about ? (
          <Type role="caption" className="mt-0.5 leading-4 text-muted" numberOfLines={2}>
            {space.about}
          </Type>
        ) : null}
        <View className="mt-1.5 flex-row items-center gap-3">
          <View className="flex-row items-center gap-1">
            <Users size={12} color={tokens.faint} />
            <Type role="micro" tabular className="text-faint">
              {space.memberCount}
            </Type>
          </View>
          {space.activeMembers24h > 0 ? (
            <Type role="micro" tabular className="text-faint">
              {space.activeMembers24h} active today
            </Type>
          ) : null}
          {space.category ? (
            <Type role="micro" className="lowercase text-faint" numberOfLines={1}>
              {space.category}
            </Type>
          ) : null}
        </View>
      </View>
    </Card>
  );
}
