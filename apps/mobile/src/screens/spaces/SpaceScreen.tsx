import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { Boxes, Copy, LogOut, MoreHorizontal, Users } from "lucide-react-native";
import { Alert, FlatList, Pressable, View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { ActionsSheet, type ActionsSheetRef, type SheetAction } from "@/components/ui/ActionsSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import {
  fetchSpaceMemberPubkeys,
  joinSpace,
  leaveSpace,
  type SpaceChannel,
  type SpaceDetail,
} from "@/lib/api/spaces";
import { cachedSpaceChannels, cachedSpaceDetail, invalidateSpace } from "@/lib/api/spaceCache";
import { isSpaceFeedType } from "@/lib/nostr/spaceFeedRoutes";
import { haptics } from "@/lib/haptics";
import { useEngine } from "@/lib/nostr/EngineContext";
import { useBackFallback } from "@/navigation/useBackFallback";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { purgeSpaceChat } from "@/store/spaceChat";
import { useTheme } from "@/theme/ThemeContext";
import { buildChannelRows, type ChannelListRow } from "./channelGroups";
import { ChannelRow } from "./components/ChannelRow";
import { MemberFacepile } from "./components/MemberFacepile";
import { SpaceHero } from "./components/SpaceHero";

// The space home: hero identity block, join/leave, member facepile, and the
// channel list grouped by category — every channel type opens its view
// (chat → Channel, notes/media/articles/music → SpaceFeed). Guest-browsable
// throughout; joining is the gated action (5.1.1(v)).

type Props = NativeStackScreenProps<SpacesStackParamList, "Space">;

export function SpaceScreen({ navigation, route }: Props) {
  const { spaceId } = route.params;
  const rootNavigation = useNavigation();
  const insets = useScreenInsets({ scroll: true });
  const { tokens } = useTheme();
  const engine = useEngine();
  const dispatch = useAppDispatch();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isGuest = useAppSelector((s) => s.identity.status === "guest");

  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [channels, setChannels] = useState<SpaceChannel[] | null>(null);
  const [members, setMembers] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const sheetRef = useRef<ActionsSheetRef>(null);

  // Deep-linked (single-route) mounts have no parent — "up" goes home.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("SpacesHome"), [navigation]),
  );

  const load = useCallback(() => {
    setError(null);
    cachedSpaceDetail(spaceId)
      .then((d) => {
        setDetail(d);
        navigation.setOptions({ title: d.name });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Space unavailable."));
    cachedSpaceChannels(spaceId).then(setChannels).catch(() => setChannels([]));
    fetchSpaceMemberPubkeys(spaceId).then(setMembers).catch(() => setMembers([]));
  }, [spaceId, navigation]);

  useEffect(load, [load]);

  const isMember = !!myPubkey && !!members?.includes(myPubkey);
  const isPlatform = detail ? detail.spaceMode !== "nip29" : true;

  // Facepile avatars need kind-0s.
  const facepilePubkeys = useMemo(() => (members ?? []).slice(0, 8), [members]);
  useEffect(() => {
    if (facepilePubkeys.length > 0) engine.requestProfiles(facepilePubkeys);
  }, [engine, facepilePubkeys]);

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
        invalidateSpace(spaceId);
        load();
      })
      .catch((e) => {
        Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
      })
      .finally(() => setJoining(false));
  }, [isGuest, myPubkey, engine, spaceId, rootNavigation, load]);

  const onLeave = useCallback(() => {
    const signer = engine.getSigner();
    if (!signer || !detail) return;
    Alert.alert(`Leave ${detail.name}?`, "You can rejoin from the directory anytime.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => {
          leaveSpace(spaceId, signer)
            .then(() => {
              haptics.warning();
              invalidateSpace(spaceId);
              dispatch(purgeSpaceChat(spaceId));
              load();
            })
            .catch((e) => {
              Alert.alert("Couldn't leave", e instanceof Error ? e.message : "Try again.");
            });
        },
      },
    ]);
  }, [engine, detail, spaceId, load, dispatch]);

  const openMembers = useCallback(
    () => navigation.navigate("SpaceMembers", { spaceId }),
    [navigation, spaceId],
  );

  const sheetActions = useMemo<SheetAction[]>(() => {
    const actions: SheetAction[] = [
      {
        icon: Users,
        label: "View members",
        onPress: () => {
          sheetRef.current?.dismiss();
          openMembers();
        },
      },
      {
        icon: Copy,
        label: "Copy space ID",
        onPress: () => {
          Clipboard.setStringAsync(spaceId).catch(() => {});
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
    ];
    if (isMember && isPlatform) {
      actions.push({
        icon: LogOut,
        label: "Leave space",
        destructive: true,
        onPress: () => {
          sheetRef.current?.dismiss();
          onLeave();
        },
      });
    }
    return actions;
  }, [spaceId, isMember, isPlatform, openMembers, onLeave]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Space actions"
          hitSlop={8}
          onPress={() => {
            haptics.selection();
            sheetRef.current?.present();
          }}
        >
          <MoreHorizontal size={22} color={tokens.heading} />
        </Pressable>
      ),
    });
  }, [navigation, tokens]);

  const openChannel = useCallback(
    (channel: SpaceChannel) => {
      if (channel.type === "chat") {
        navigation.navigate("Channel", { spaceId, channelId: channel.id });
      } else if (isSpaceFeedType(channel.type)) {
        navigation.navigate("SpaceFeed", {
          spaceId,
          channelId: channel.id,
          channelType: channel.type,
          label: channel.label,
        });
      }
    },
    [navigation, spaceId],
  );

  // Channels grouped by category (position order preserved; ungrouped first).
  const rows = useMemo(
    () => buildChannelRows(channels, detail?.spaceMode),
    [channels, detail],
  );

  const renderRow = useCallback(
    ({ item }: { item: ChannelListRow }) => {
      if (item.kind === "category") {
        return <SectionHeader label={item.label.toLowerCase()} className="pt-3" />;
      }
      const enterable = item.channel.type === "chat" || isSpaceFeedType(item.channel.type);
      return (
        <ChannelRow
          channel={item.channel}
          onPress={enterable ? () => openChannel(item.channel) : undefined}
        />
      );
    },
    [openChannel],
  );

  const memberCount = detail?.memberCount || members?.length || 0;

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
        }}
        ListHeaderComponent={
          <SpaceScreenHeader
            detail={detail}
            error={error}
            isMember={isMember}
            isPlatform={isPlatform}
            joining={joining}
            memberCount={memberCount}
            facepilePubkeys={facepilePubkeys}
            onJoin={onJoin}
            onOpenMembers={openMembers}
          />
        }
        ListEmptyComponent={
          channels === null ? (
            <View className="gap-2.5 pt-2">
              {Array.from({ length: 4 }, (_, i) => (
                <View key={i} className="flex-row items-center gap-3 rounded-xl bg-card p-4">
                  <SkeletonCircle size={40} />
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
      <ActionsSheet ref={sheetRef} title={detail?.name ?? "space"} actions={sheetActions} />
    </View>
  );
}

function SpaceScreenHeader({
  detail,
  error,
  isMember,
  isPlatform,
  joining,
  memberCount,
  facepilePubkeys,
  onJoin,
  onOpenMembers,
}: {
  detail: SpaceDetail | null;
  error: string | null;
  isMember: boolean;
  isPlatform: boolean;
  joining: boolean;
  memberCount: number;
  facepilePubkeys: string[];
  onJoin: () => void;
  onOpenMembers: () => void;
}) {
  if (error) {
    return (
      <View className="pb-4">
        <EmptyState icon={Boxes} title="Space unavailable" message={error} />
      </View>
    );
  }
  if (!detail) {
    return (
      <View className="pb-6 pt-2">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <View className="mt-4 flex-row items-center gap-4">
          <SkeletonCircle size={68} />
          <View className="flex-1 gap-2">
            <Skeleton className="h-5 w-40" />
            <SkeletonText lines={2} />
          </View>
        </View>
      </View>
    );
  }
  return (
    <View className="pb-2 pt-2">
      <SpaceHero detail={detail} isMember={isMember} />

      {!isMember && isPlatform ? (
        <View className="mt-4">
          <Button onPress={onJoin} loading={joining}>
            Join space
          </Button>
        </View>
      ) : null}

      {facepilePubkeys.length > 0 ? (
        <View className="mt-3">
          <MemberFacepile
            pubkeys={facepilePubkeys}
            memberCount={memberCount}
            onPress={onOpenMembers}
          />
        </View>
      ) : null}

      <SectionHeader label="channels" />
    </View>
  );
}
