import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { Boxes, Copy, LogOut, MoreHorizontal, UsersRound } from "lucide-react-native";
import { Alert, FlatList, Pressable, RefreshControl, View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { ActionsSheet, type ActionsSheetRef, type SheetAction } from "@/components/ui/ActionsSheet";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import { invalidateMembership, isMemberOf } from "@/lib/api/membership";
import { joinSpace, leaveSpace, type SpaceChannel, type SpaceDetail } from "@/lib/api/spaces";
import { isSpaceFeedType } from "@/lib/nostr/spaceFeedRoutes";
import { haptics } from "@/lib/haptics";
import { useEngine } from "@/lib/nostr/EngineContext";
import { useBackFallback } from "@/navigation/useBackFallback";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { purgeSpaceChat } from "@/store/spaceChat";
import { invalidateSpaceMeta } from "@/store/spaceMeta";
import { useTheme } from "@/theme/ThemeContext";
import { buildChannelRows, type ChannelListRow } from "./channelGroups";
import { ChannelRow } from "./components/ChannelRow";
import { MemberFacepile } from "./components/MemberFacepile";
import { SpaceHero } from "./components/SpaceHero";
import { useSpaceMeta } from "./useSpaceMeta";

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

  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [joining, setJoining] = useState(false);
  const sheetRef = useRef<ActionsSheetRef>(null);

  // Deep-linked (single-route) mounts have no parent — "up" goes home.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("SpacesHome"), [navigation]),
  );

  // Detail/channels + display roster from the SWR cache — instant paint on
  // revisits; the thunk seeds the backend-cached member profiles itself.
  const { detail, channels, memberPubkeys, status, error, refresh } =
    useSpaceMeta(spaceId);

  useEffect(() => {
    if (detail) navigation.setOptions({ title: detail.name });
  }, [navigation, detail]);

  // Membership stays uncached-by-contract (join CTA correctness) — checked
  // through membership.ts's 10s dedup window, never the display roster.
  useEffect(() => {
    if (!myPubkey) {
      setIsMember(false);
      return;
    }
    let cancelled = false;
    isMemberOf(spaceId, myPubkey)
      .then((member) => {
        if (!cancelled) setIsMember(member);
      })
      .catch(() => {
        if (!cancelled) setIsMember(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, myPubkey]);

  const isPlatform = detail ? detail.spaceMode !== "nip29" : true;

  // Facepile avatars need kind-0s (display-only roster prefix).
  const facepilePubkeys = useMemo(() => memberPubkeys.slice(0, 8), [memberPubkeys]);
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
        setIsMember(true);
        invalidateMembership(spaceId);
        dispatch(invalidateSpaceMeta(spaceId));
      })
      .catch((e) => {
        Alert.alert("Couldn't join", e instanceof Error ? e.message : "Try again.");
      })
      .finally(() => setJoining(false));
  }, [isGuest, myPubkey, engine, spaceId, rootNavigation, dispatch]);

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
              setIsMember(false);
              invalidateMembership(spaceId);
              dispatch(invalidateSpaceMeta(spaceId));
              dispatch(purgeSpaceChat(spaceId));
            })
            .catch((e) => {
              Alert.alert("Couldn't leave", e instanceof Error ? e.message : "Try again.");
            });
        },
      },
    ]);
  }, [engine, detail, spaceId, dispatch]);

  const openMembers = useCallback(
    () => navigation.navigate("SpaceMembers", { spaceId }),
    [navigation, spaceId],
  );

  const sheetActions = useMemo<SheetAction[]>(() => {
    const actions: SheetAction[] = [
      {
        icon: UsersRound,
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

  const memberCount = detail?.memberCount || memberPubkeys.length || 0;

  // Stale-while-revalidate: a failed background refresh keeps the cached
  // hero on screen; the error page needs an empty cache.
  const blockingError = detail ? null : error;

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
        refreshControl={
          <RefreshControl
            refreshing={status === "refreshing"}
            onRefresh={refresh}
            tintColor={tokens.muted}
          />
        }
        ListHeaderComponent={
          <SpaceScreenHeader
            detail={detail}
            error={blockingError}
            isMember={isMember === true}
            isPlatform={isPlatform}
            joining={joining}
            memberCount={memberCount}
            facepilePubkeys={facepilePubkeys}
            onJoin={onJoin}
            onOpenMembers={openMembers}
          />
        }
        ListEmptyComponent={
          blockingError ? null : channels === null ? (
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
          ) : (
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
