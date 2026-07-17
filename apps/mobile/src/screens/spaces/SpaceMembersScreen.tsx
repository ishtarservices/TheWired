import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { UsersRound } from "lucide-react-native";
import { FlatList, Pressable, View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import {
  fetchSpaceMemberRoles,
  fetchSpaceMembers,
  fetchSpaceRoles,
} from "@/lib/api/spaces";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useBackFallback } from "@/navigation/useBackFallback";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { profilesHydrated } from "@/store/slices/profilesSlice";
import { ensureSpaceMeta } from "@/store/spaceMeta";
import { buildRoleGroups, type RoleGroup } from "./roleGroups";

// Role-grouped member roster (desktop MemberList, Discord register): color
// dot + role name headers, member names tinted by role color. Falls back to
// a flat list when the space has no backend roles (NIP-29-native mirrors).

type Props = NativeStackScreenProps<SpacesStackParamList, "SpaceMembers">;

type Row =
  | { kind: "group"; key: string; group: RoleGroup }
  | { kind: "member"; key: string; pubkey: string; color: string | null };

const PROFILE_BACKFILL_CAP = 200;

export function SpaceMembersScreen({ route, navigation }: Props) {
  const { spaceId } = route.params;
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const dispatch = useAppDispatch();
  const insets = useScreenInsets({ scroll: true });
  const profiles = useAppSelector((s) => s.profiles.byPubkey);

  // Deep-linked (single-route) mounts have no parent — "up" goes to the space.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("Space", { spaceId }), [navigation, spaceId]),
  );

  const [groups, setGroups] = useState<RoleGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      fetchSpaceMemberRoles(spaceId),
      fetchSpaceRoles(spaceId),
      // Meta cache for creatorPubkey — instant on drill-downs from the space.
      dispatch(ensureSpaceMeta(spaceId))
        .then((meta) => meta?.detail ?? null)
        .catch(() => null),
    ])
      .then(async ([memberRoles, roles, detail]) => {
        // Inline backend profiles paint the roster in one round trip; the
        // capped kind-0 backfill below stays as the freshener.
        if (Object.keys(memberRoles.profiles).length > 0) {
          dispatch(profilesHydrated(memberRoles.profiles));
        }
        if (memberRoles.members.length > 0) {
          setGroups(
            buildRoleGroups(memberRoles.members, roles, detail?.creatorPubkey ?? null),
          );
          return;
        }
        // No backend roster (native space) — flat pubkey list, one group.
        const flat = await fetchSpaceMembers(spaceId);
        if (Object.keys(flat.profiles).length > 0) {
          dispatch(profilesHydrated(flat.profiles));
        }
        setGroups(
          flat.pubkeys.length > 0
            ? [
                {
                  roleId: "__flat__",
                  label: "Members",
                  color: null,
                  position: 0,
                  pubkeys: flat.pubkeys,
                },
              ]
            : [],
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Members unavailable."));
  }, [spaceId, dispatch]);

  useEffect(load, [load]);

  const rows = useMemo<Row[]>(() => {
    if (!groups) return [];
    const out: Row[] = [];
    for (const group of groups) {
      out.push({ kind: "group", key: `group-${group.roleId}`, group });
      for (const pubkey of group.pubkeys) {
        out.push({ kind: "member", key: `${group.roleId}:${pubkey}`, pubkey, color: group.color });
      }
    }
    return out;
  }, [groups]);

  // Backfill kind-0s (capped — huge rosters resolve as they're scrolled to
  // on other surfaces; this covers the realistic page).
  useEffect(() => {
    if (!groups) return;
    const pubkeys = groups.flatMap((g) => g.pubkeys).slice(0, PROFILE_BACKFILL_CAP);
    if (pubkeys.length > 0) engine.requestProfiles(pubkeys);
  }, [engine, groups]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === "group") {
        return (
          <View className="flex-row items-center gap-2 px-1 pb-2 pt-5">
            <View
              className="h-2 w-2 rounded-full bg-surface-hover"
              style={item.group.color ? { backgroundColor: item.group.color } : undefined}
            />
            <Type
              role="caption"
              weight={600}
              className="lowercase tracking-wide text-muted"
              style={item.group.color ? { color: item.group.color } : undefined}
            >
              {item.group.label}
            </Type>
            <Type role="micro" tabular className="text-faint">
              {item.group.pubkeys.length}
            </Type>
          </View>
        );
      }
      const profile = profiles[item.pubkey];
      const name = profileDisplayName(profile, item.pubkey);
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${name}'s profile`}
          onPress={() => rootNavigation.navigate("Profile", { pubkey: item.pubkey })}
          className="min-h-[48px] flex-row items-center gap-3 rounded-xl px-3 py-1.5 active:bg-surface-hover"
        >
          <Avatar uri={profile?.picture} name={name} pubkey={item.pubkey} size={36} />
          <Type
            role="body"
            weight={500}
            className="flex-1 text-heading"
            style={item.color ? { color: item.color } : undefined}
            numberOfLines={1}
          >
            {name}
          </Type>
        </Pressable>
      );
    },
    [profiles, rootNavigation],
  );

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
        ListEmptyComponent={
          groups === null && !error ? (
            <View className="gap-3 pt-4">
              {Array.from({ length: 8 }, (_, i) => (
                <View key={i} className="flex-row items-center gap-3 px-3">
                  <SkeletonCircle size={36} />
                  <Skeleton className="h-3.5 w-36" />
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon={UsersRound}
              title={error ? "Members unavailable" : "No members listed"}
              message={error ?? "This space hasn't published a member list the app can read."}
            />
          )
        }
        initialNumToRender={20}
        windowSize={9}
      />
    </View>
  );
}
