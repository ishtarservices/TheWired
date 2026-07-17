// The selected space's content on SpacesHome (replaces the W7 SpacePane):
// SpaceHeader + the grouped channel list (live now → text → music → feeds)
// as one FlatList. Rows are dense and hairline-divided, enriched only with
// data the app has already fetched (spacePreviews slice) — a bare row is the
// designed state, not a failure. Long-press opens the channel quick-actions
// sheet. Remounts per space via key={spaceId} in the parent; the space-meta
// cache makes rapid switcher hops instant (SQLite hydrate + SWR refresh).

import { useCallback, useEffect, useMemo } from "react";
import { Boxes } from "lucide-react-native";
import { FlatList, View } from "react-native";
import type { SpaceChannel } from "@/lib/api/spaces";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { useAppSelector } from "@/store/hooks";
import { buildChannelSections, type SectionRow } from "../channelSections";
import { selectLiveItems } from "../liveItems";
import { useChannelActions } from "../useChannelActions";
import { useSpaceMeta } from "../useSpaceMeta";
import {
  ChannelRowConnected,
  LiveNowRowConnected,
  MusicChannelRowConnected,
} from "./ChannelRowConnected";
import { SpaceHeader } from "./SpaceHeader";

const HEADER_MEMBERS_SHOWN = 3;

export function SpaceChannelList({
  spaceId,
  paddingBottom,
  onOpenSpace,
  onOpenChannel,
}: {
  spaceId: string;
  paddingBottom: number;
  onOpenSpace: () => void;
  onOpenChannel: (channel: SpaceChannel) => void;
}) {
  const engine = useEngine();
  const channelActions = useChannelActions(spaceId);

  // Space meta (detail/channels/display roster) from the SWR cache —
  // instant SQLite paint on switcher hops, background refresh on focus.
  // Backend-cached member profiles are seeded by the thunk itself.
  const { detail, channels, memberPubkeys, error, refresh } = useSpaceMeta(spaceId);

  // NO whole-map selectors here (previews/lastReadAt/profiles) — the
  // space-signal sub updates those live, and a map subscription would
  // re-render every row per incoming kind-9/kind-0. Rows connect themselves
  // (ChannelRowConnected) with per-key selectors.
  const liveItems = useAppSelector((s) => selectLiveItems(s, spaceId));

  // Kind-0 backfill for the presence stack.
  useEffect(() => {
    if (memberPubkeys.length > 0) {
      engine.requestProfiles(memberPubkeys.slice(0, HEADER_MEMBERS_SHOWN));
    }
  }, [engine, memberPubkeys]);

  const rows = useMemo(
    () => buildChannelSections(channels, detail?.spaceMode, liveItems),
    [channels, detail?.spaceMode, liveItems],
  );

  // Deps are stable handlers only — a preview/profile update re-renders
  // exactly the affected connected row, never the list.
  const openSheet = channelActions.open;
  const renderRow = useCallback(
    ({ item }: { item: SectionRow }) => {
      switch (item.kind) {
        case "header":
          return (
            <View className="px-4 pb-1.5 pt-5">
              <Type role="metaLabel" className="lowercase text-muted">
                {item.label}
              </Type>
            </View>
          );
        case "live":
          return <LiveNowRowConnected item={item.item} />;
        case "musicChannel":
          return (
            <MusicChannelRowConnected
              spaceId={spaceId}
              channel={item.channel}
              onOpenChannel={onOpenChannel}
              onLongPressChannel={openSheet}
            />
          );
        case "channel":
          return (
            <ChannelRowConnected
              spaceId={spaceId}
              channel={item.channel}
              enterable={item.enterable}
              onOpenChannel={onOpenChannel}
              onLongPressChannel={openSheet}
            />
          );
      }
    },
    [spaceId, onOpenChannel, openSheet],
  );

  // A failed background refresh keeps stale data on screen — the error
  // page only shows when there's nothing to paint at all.
  if (error && !detail) {
    return (
      <View className="flex-1" style={{ paddingBottom }}>
        <EmptyState
          icon={Boxes}
          title="Space unavailable"
          message={error}
          action={
            <Button variant="secondary" onPress={refresh}>
              Try again
            </Button>
          }
        />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        contentContainerStyle={{ paddingBottom: paddingBottom + 16 }}
        ListHeaderComponent={
          <SpaceHeader
            detail={detail}
            memberPubkeys={memberPubkeys}
            onOpenSpace={onOpenSpace}
          />
        }
        ListEmptyComponent={
          channels === null ? (
            <View className="gap-3 px-4 pt-2">
              {Array.from({ length: 4 }, (_, i) => (
                <View key={i} className="flex-row items-center gap-3 py-2.5">
                  <SkeletonCircle size={20} />
                  <Skeleton className="h-3.5 w-40" />
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
      {channelActions.sheet}
    </>
  );
}
