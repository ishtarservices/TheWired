// One avatar in an overlap stack (SpaceHeader, MemberFacepile). Connects
// itself to the profile map — a kind-0 arrival re-renders one bubble, never
// the whole header/facepile (the same narrow-selector discipline as
// ChannelRowConnected).

import { memo } from "react";
import { View } from "react-native";

import { Avatar } from "@/components/ui/Avatar";
import { useAppSelector } from "@/store/hooks";

export const MemberBubble = memo(function MemberBubble({
  pubkey,
  size,
  overlap = 0,
}: {
  pubkey: string;
  size: number;
  /** Negative left margin for stacking (0 on the first bubble). */
  overlap?: number;
}) {
  const profile = useAppSelector((s) => s.profiles.byPubkey[pubkey]);
  return (
    <View
      className="rounded-full bg-background p-0.5"
      style={overlap !== 0 ? { marginLeft: overlap } : undefined}
    >
      <Avatar uri={profile?.picture} name={profile?.name} pubkey={pubkey} size={size} />
    </View>
  );
});
