// The selected space's content on SpacesHome (replaces the W7 SpacePane):
// SpaceHeader + the grouped channel list (live now → text → music → feeds)
// as one FlatList. Rows are dense and hairline-divided, enriched only with
// data the app has already fetched (spacePreviews slice) — a bare row is the
// designed state, not a failure. Long-press opens the channel quick-actions
// sheet. Remounts per space via key={spaceId} in the parent; spaceCache
// makes rapid switcher hops cheap.

import { useCallback, useEffect, useState } from "react";
import { Boxes } from "lucide-react-native";
import { FlatList, View } from "react-native";
import type { SpaceChannel, SpaceDetail } from "@/lib/api/spaces";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import {
  cachedSpaceChannels,
  cachedSpaceDetail,
  cachedSpaceMembers,
} from "@/lib/api/spaceCache";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import {
  channelKey,
  selectSpaceMusicArtwork,
} from "@/store/slices/spacePreviewsSlice";
import { buildChannelSections, type SectionRow } from "../channelSections";
import { selectLiveItems } from "../liveItems";
import { useChannelActions } from "../useChannelActions";
import { ChannelRowRich } from "./ChannelRowRich";
import { LiveNowRow } from "./LiveNowRow";
import { MusicChannelRow } from "./MusicChannelRow";
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
  const [detail, setDetail] = useState<SpaceDetail | null>(null);
  const [channels, setChannels] = useState<SpaceChannel[] | null>(null);
  const [memberPubkeys, setMemberPubkeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const channelActions = useChannelActions(spaceId);

  const liveItems = useAppSelector((s) => selectLiveItems(s, spaceId));
  const previews = useAppSelector((s) => s.spacePreviews.previews);
  const lastReadAt = useAppSelector((s) => s.spacePreviews.lastReadAt);
  const artworks = useAppSelector((s) => selectSpaceMusicArtwork(s, spaceId));
  const profiles = useAppSelector((s) => s.profiles.byPubkey);

  const load = useCallback(() => {
    setError(null);
    setDetail(null);
    setChannels(null);
    cachedSpaceDetail(spaceId)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : "Space unavailable."));
    cachedSpaceChannels(spaceId).then(setChannels).catch(() => setChannels([]));
    // Display-only avatar stack — membership checks stay uncached elsewhere.
    cachedSpaceMembers(spaceId).then(setMemberPubkeys).catch(() => {});
  }, [spaceId]);

  useEffect(load, [load]);

  // Kind-0 backfill for the presence stack.
  useEffect(() => {
    if (memberPubkeys.length > 0) {
      engine.requestProfiles(memberPubkeys.slice(0, HEADER_MEMBERS_SHOWN));
    }
  }, [engine, memberPubkeys]);

  const rows = buildChannelSections(channels, detail?.spaceMode, liveItems);

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
          return (
            <LiveNowRow
              item={item.item}
              participantNames={item.item.participantPubkeys.map((pubkey) =>
                profileDisplayName(profiles[pubkey], pubkey),
              )}
              // Unreachable until a live source exists (selectLiveItems → []);
              // voice/listen-together wire the real join here.
              onJoin={() => {}}
            />
          );
        case "musicChannel":
          return (
            <MusicChannelRow
              channel={item.channel}
              artworks={artworks}
              onPress={() => onOpenChannel(item.channel)}
              onLongPress={() => channelActions.open(item.channel)}
            />
          );
        case "channel": {
          const key = channelKey(spaceId, item.channel.id);
          const preview = previews[key];
          const readAt = lastReadAt[key];
          const unreadCount =
            readAt === undefined || !preview
              ? 0
              : preview.eventTimestamps.filter((t) => t > readAt).length;
          return (
            <ChannelRowRich
              channel={item.channel}
              enterable={item.enterable}
              preview={
                preview
                  ? {
                      lastText: preview.lastText,
                      senderName: profileDisplayName(
                        profiles[preview.lastSenderPubkey],
                        preview.lastSenderPubkey,
                      ),
                      lastEventAt: preview.lastEventAt,
                    }
                  : undefined
              }
              unreadCount={unreadCount}
              onPress={item.enterable ? () => onOpenChannel(item.channel) : undefined}
              onLongPress={() => channelActions.open(item.channel)}
            />
          );
        }
      }
    },
    [
      spaceId,
      previews,
      lastReadAt,
      artworks,
      profiles,
      onOpenChannel,
      channelActions,
    ],
  );

  if (error) {
    return (
      <View className="flex-1" style={{ paddingBottom }}>
        <EmptyState
          icon={Boxes}
          title="Space unavailable"
          message={error}
          action={
            <Button variant="secondary" onPress={load}>
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
