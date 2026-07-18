import { useCallback, useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { Music } from "lucide-react-native";
import { Image, Pressable, ScrollView, View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { fetchTrendingTracks } from "@/lib/api/music";
import { haptics } from "@/lib/haptics";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { TrackRow } from "@/screens/spaces/components/TrackRow";
import type { MusicItem } from "@/screens/spaces/musicEventParser";
import { useMySpaces } from "@/screens/spaces/useSpaceMeta";
import { playQueue } from "@/store/music";
import { useAppDispatch } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Music tab landing: public trending browse (guest-friendly — /music/browse is
// unauthenticated and drops any space/private content) plus a rail of the
// caller's joined spaces (their music lives in space music channels). Tapping a
// trending track plays the whole trending list as the queue.

export function MusicHomeScreen() {
  const rootNavigation = useNavigation();
  const dispatch = useAppDispatch();
  const insets = useScreenInsets({ scroll: true });
  const { tokens } = useTheme();
  const { spaces } = useMySpaces();

  const [trending, setTrending] = useState<MusicItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetchTrendingTracks(30)
      .then(setTrending)
      .catch((e) => {
        setTrending([]);
        setError(e instanceof Error ? e.message : "Couldn't load music.");
      });
  }, []);
  useEffect(load, [load]);

  const playFromTrending = useCallback(
    (track: MusicItem) => {
      if (!trending) return;
      const idx = trending.findIndex((t) => t.id === track.id);
      haptics.selection();
      void dispatch(playQueue(trending, Math.max(0, idx)));
    },
    [trending, dispatch],
  );

  const openSpace = useCallback(
    (spaceId: string) =>
      rootNavigation.navigate("Tabs", {
        screen: "SpacesTab",
        params: { screen: "Space", params: { spaceId } },
      }),
    [rootNavigation],
  );

  const loading = trending === null;
  const mySpaces = spaces ?? [];

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingTop: insets.top + 8,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 16,
      }}
    >
      {mySpaces.length > 0 ? (
        <View className="mb-6">
          <Type role="meta" className="mb-3 text-faint">
            YOUR SPACES
          </Type>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 12 }}
          >
            {mySpaces.map((space) => {
              const pic = safeImageUri(space.picture);
              return (
                <Pressable
                  key={space.id}
                  onPress={() => openSpace(space.id)}
                  accessibilityRole="button"
                  accessibilityLabel={space.name}
                  className="w-[72px]"
                >
                  {pic ? (
                    <Image
                      source={{ uri: pic }}
                      style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: tokens.surface }}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <View
                      style={{
                        width: 72,
                        height: 72,
                        borderRadius: 12,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: tokens.surface,
                      }}
                    >
                      <Music size={22} color={tokens.muted} strokeWidth={1.75} />
                    </View>
                  )}
                  <Type role="micro" className="mt-1.5 text-muted" numberOfLines={1}>
                    {space.name}
                  </Type>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <Type role="meta" className="mb-3 text-faint">
        TRENDING
      </Type>
      {loading ? (
        <View className="gap-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i} className="flex-row items-center gap-3 rounded-xl bg-card p-3">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-24" />
              </View>
            </View>
          ))}
        </View>
      ) : trending.length === 0 ? (
        <EmptyState
          icon={Music}
          title={error ? "Music unavailable" : "No music yet"}
          message={error ?? "Trending tracks appear here as artists publish."}
          action={
            error ? (
              <Button variant="secondary" onPress={load}>
                Try again
              </Button>
            ) : undefined
          }
        />
      ) : (
        <View className="gap-2.5">
          {trending.map((track) => (
            <TrackRow key={track.id} item={track} onPress={() => playFromTrending(track)} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}
