import { useCallback, useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Boxes, Hash, Users } from "lucide-react-native";
import { Alert, FlatList, View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { Pill } from "@/components/ui/Pill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import {
  fetchSpaceChannels,
  fetchSpaceDetail,
  fetchSpaceMemberPubkeys,
  joinSpace,
  type SpaceChannel,
  type SpaceDetail,
} from "@/lib/api/spaces";
import { haptics } from "@/lib/haptics";
import { useEngine } from "@/lib/nostr/EngineContext";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Space detail (W6): header + channel list from a directory row. Fully
// guest-browsable (public GETs); joining is the gated action (5.1.1(v)).
// Only chat channels are enterable this phase — other types are visible but
// inert until their views port.

type Props = NativeStackScreenProps<SpacesStackParamList, "Space">;

export function SpaceScreen({ navigation, route }: Props) {
  const { spaceId } = route.params;
  const rootNavigation = useNavigation();
  const insets = useScreenInsets({ scroll: true });
  const { tokens } = useTheme();
  const engine = useEngine();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isGuest = useAppSelector((s) => s.identity.status === "guest");

  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [channels, setChannels] = useState<SpaceChannel[] | null>(null);
  const [members, setMembers] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const load = useCallback(() => {
    setError(null);
    fetchSpaceDetail(spaceId)
      .then((d) => {
        setDetail(d);
        navigation.setOptions({ title: d.name });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Space unavailable."));
    fetchSpaceChannels(spaceId).then(setChannels).catch(() => setChannels([]));
    fetchSpaceMemberPubkeys(spaceId).then(setMembers).catch(() => setMembers([]));
  }, [spaceId, navigation]);

  useEffect(load, [load]);

  const isMember = !!myPubkey && !!members?.includes(myPubkey);
  const isPlatform = detail ? detail.spaceMode !== "nip29" : true;

  const onJoin = useCallback(() => {
    // Guests join by signing in first — the auth screens are mounted as
    // modals in guest mode, so this happens in place (5.1.1(v)).
    if (isGuest || !myPubkey) {
      rootNavigation.navigate("Login");
      return;
    }
    const signer = engine.getSigner();
    if (!signer) return;
    setJoining(true);
    haptics.tap();
    joinSpace(spaceId, signer)
      .then(() => {
        haptics.success();
        fetchSpaceMemberPubkeys(spaceId).then(setMembers).catch(() => {});
      })
      .catch((e) => {
        Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
      })
      .finally(() => setJoining(false));
  }, [isGuest, myPubkey, engine, spaceId, rootNavigation]);

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={channels ?? []}
        keyExtractor={(c) => c.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
        }}
        ListHeaderComponent={
          <SpaceHeader
            detail={detail}
            memberCount={members?.length ?? null}
            error={error}
            isMember={isMember}
            isPlatform={isPlatform}
            joining={joining}
            onJoin={onJoin}
          />
        }
        renderItem={({ item }) => {
          const enterable = item.type === "chat";
          return (
            <ListRow
              title={`#${item.label}`}
              subtitle={
                enterable
                  ? item.isDefault
                    ? "chat · default"
                    : "chat"
                  : `${item.type} · arrives in a later phase`
              }
              leading={<Hash size={18} color={enterable ? tokens.primary : tokens.faint} />}
              onPress={
                enterable
                  ? () => navigation.navigate("Channel", { spaceId, channelId: item.id })
                  : undefined
              }
              className={enterable ? "rounded-xl" : "rounded-xl opacity-50"}
            />
          );
        }}
        ListEmptyComponent={
          channels === null ? (
            <View className="gap-2.5 pt-2">
              {Array.from({ length: 4 }, (_, i) => (
                <View key={i} className="flex-row items-center gap-3 rounded-xl bg-card p-4">
                  <SkeletonCircle size={32} />
                  <View className="flex-1 gap-2">
                    <Skeleton className="h-3.5 w-28" />
                    <SkeletonText lines={1} />
                  </View>
                </View>
              ))}
            </View>
          ) : error ? null : (
            <EmptyState
              icon={Boxes}
              title="No channels listed"
              message="This space hasn't published channels the app can read yet."
            />
          )
        }
      />
    </View>
  );
}

function SpaceHeader({
  detail,
  memberCount,
  error,
  isMember,
  isPlatform,
  joining,
  onJoin,
}: {
  detail: SpaceDetail | null;
  memberCount: number | null;
  error: string | null;
  isMember: boolean;
  isPlatform: boolean;
  joining: boolean;
  onJoin: () => void;
}) {
  const { tokens } = useTheme();
  if (error) {
    return (
      <View className="pb-4">
        <EmptyState icon={Boxes} title="Space unavailable" message={error} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View className="flex-row items-center gap-4 pb-6 pt-2">
        <SkeletonCircle size={64} />
        <View className="flex-1 gap-2">
          <Skeleton className="h-5 w-40" />
          <SkeletonText lines={2} />
        </View>
      </View>
    );
  }
  return (
    <View className="pb-4 pt-2">
      <View className="flex-row items-center gap-4">
        <Avatar uri={detail.picture} name={detail.name} pubkey={detail.id} size={64} />
        <View className="flex-1">
          <Type role="title" className="text-heading" numberOfLines={2}>
            {detail.name}
          </Type>
          <View className="mt-1 flex-row items-center gap-3">
            {memberCount !== null ? (
              <View className="flex-row items-center gap-1">
                <Users size={13} color={tokens.faint} />
                <Type role="micro" tabular className="text-faint">
                  {memberCount} member{memberCount === 1 ? "" : "s"}
                </Type>
              </View>
            ) : null}
            {isMember ? <Pill label="member" tone="primary" /> : null}
          </View>
        </View>
      </View>
      {detail.about ? (
        <Type role="caption" className="mt-3 leading-5 text-soft">
          {detail.about}
        </Type>
      ) : null}
      {detail.tags.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {detail.tags.slice(0, 6).map((tag) => (
            <Pill key={tag} label={tag} />
          ))}
        </View>
      ) : null}
      {!isMember && isPlatform ? (
        <View className="mt-4">
          <Button variant="secondary" onPress={onJoin} loading={joining}>
            Join space
          </Button>
        </View>
      ) : null}
      <View className="mt-5">
        <SectionHeader label="channels" />
      </View>
    </View>
  );
}
