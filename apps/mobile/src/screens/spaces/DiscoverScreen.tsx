import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Boxes, Search, SearchX, X } from "lucide-react-native";
import { FlatList, Pressable, RefreshControl, TextInput, View } from "react-native";

import { useScreenInsets } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, SkeletonCircle, SkeletonText } from "@/components/ui/Skeleton";
import {
  fetchCategories,
  fetchFeaturedSpaces,
  fetchListedSpaces,
  type DirectorySort,
  type ListedSpace,
  type SpaceCategory,
} from "@/lib/api/discovery";
import { haptics } from "@/lib/haptics";
import { useTheme } from "@/theme/ThemeContext";
import { useBackFallback } from "@/navigation/useBackFallback";
import type { SpacesStackParamList } from "@/navigation/types";
import { ChipRow } from "./components/ChipRow";
import { FeaturedCarousel } from "./components/FeaturedCarousel";
import { SpaceDirectoryCard } from "./components/SpaceDirectoryCard";

// Discover — the public spaces directory as its own section (pushed from the
// Spaces home rail): search + featured + categories + sortable list. Fully
// guest-browsable; joining gates on the Space screen (5.1.1(v)). Searching
// or picking a category switches into results mode (featured rail hides).

type Props = NativeStackScreenProps<SpacesStackParamList, "Discover">;

const SORT_CHIPS: Array<{ value: DirectorySort; label: string }> = [
  { value: "trending", label: "trending" },
  { value: "newest", label: "newest" },
  { value: "popular", label: "popular" },
];

export function DiscoverScreen({ navigation }: Props) {
  const { tokens } = useTheme();
  const insets = useScreenInsets({ scroll: true });

  // Deep-linked (single-route) mounts — e.g. thewired.app/discover, or Expo
  // Go re-firing the last dev URL on relaunch — have no parent beneath;
  // "up" goes to the Spaces home so Discover never traps the tab.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("SpacesHome"), [navigation]),
  );

  const [directory, setDirectory] = useState<ListedSpace[] | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [featured, setFeatured] = useState<ListedSpace[] | null>(null);
  const [categories, setCategories] = useState<SpaceCategory[]>([]);
  const [sort, setSort] = useState<DirectorySort>("trending");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filtering = debouncedSearch.length > 0 || category !== "all";

  const loadRails = useCallback(() => {
    fetchFeaturedSpaces()
      .then(setFeatured)
      .catch(() => setFeatured([]));
    fetchCategories()
      .then(setCategories)
      .catch(() => {});
  }, []);

  useEffect(loadRails, [loadRails]);

  // B8 — last-write-wins guard: rapid sort/category/search toggles can
  // resolve out of order and paint stale results over fresh ones. Only the
  // newest in-flight request may touch state (success AND error paths).
  const directorySeqRef = useRef(0);
  const loadDirectory = useCallback(() => {
    const seq = ++directorySeqRef.current;
    setDirectoryError(null);
    return fetchListedSpaces({
      sort,
      category: category === "all" ? undefined : category,
      search: debouncedSearch || undefined,
    })
      .then((spaces) => {
        if (seq !== directorySeqRef.current) return;
        setDirectory(spaces);
      })
      .catch((e) => {
        if (seq !== directorySeqRef.current) return;
        setDirectory([]);
        setDirectoryError(e instanceof Error ? e.message : "Couldn't load the directory.");
      });
  }, [sort, category, debouncedSearch]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    haptics.selection();
    loadRails();
    loadDirectory().finally(() => setRefreshing(false));
  }, [loadRails, loadDirectory]);

  const openSpace = useCallback(
    (spaceId: string) => navigation.navigate("Space", { spaceId }),
    [navigation],
  );

  const renderSpace = useCallback(
    ({ item }: { item: ListedSpace }) => (
      <SpaceDirectoryCard space={item} onPress={() => openSpace(item.id)} />
    ),
    [openSpace],
  );

  const categoryChips = useMemo(
    () => [
      { value: "all", label: "all" },
      ...categories.map((c) => ({ value: c.slug, label: c.name })),
    ],
    [categories],
  );

  const header = (
    <View className="pb-1">
      {/* Search */}
      <View className="h-11 flex-row items-center gap-2 rounded-2xl bg-field px-3.5">
        <Search size={16} color={tokens.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search spaces"
          placeholderTextColor={tokens.faint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          className="flex-1"
          style={{ color: tokens.heading, paddingVertical: 0 }}
        />
        {search.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => setSearch("")}
          >
            <X size={16} color={tokens.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Featured hides in results mode */}
      {!filtering && featured === null ? (
        <>
          <SectionHeader label="featured" />
          <View className="flex-row gap-2.5">
            <Skeleton className="h-40 w-56 rounded-2xl" />
            <Skeleton className="h-40 w-56 rounded-2xl" />
          </View>
        </>
      ) : null}
      {!filtering && featured && featured.length > 0 ? (
        <>
          <SectionHeader label="featured" />
          <FeaturedCarousel spaces={featured} onPressSpace={openSpace} />
        </>
      ) : null}

      {categoryChips.length > 1 ? (
        <>
          <SectionHeader label="browse" />
          <ChipRow chips={categoryChips} selected={category} onSelect={setCategory} />
        </>
      ) : null}

      <View className="mt-2.5">
        <ChipRow
          chips={SORT_CHIPS}
          selected={sort}
          onSelect={(value) => setSort(value as DirectorySort)}
        />
      </View>

      <SectionHeader label={filtering ? "results" : "all spaces"} />
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={directory ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderSpace}
        ListHeaderComponent={header}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 16,
        }}
        ItemSeparatorComponent={RowSeparator}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.muted} />
        }
        ListEmptyComponent={
          directory === null ? (
            <View className="gap-2.5">
              {Array.from({ length: 5 }, (_, i) => (
                <SpaceRowSkeleton key={i} />
              ))}
            </View>
          ) : directoryError ? (
            <EmptyState
              icon={Boxes}
              title="Directory unavailable"
              message={directoryError}
              action={
                <Button variant="secondary" onPress={loadDirectory}>
                  Try again
                </Button>
              }
            />
          ) : filtering ? (
            <EmptyState
              icon={SearchX}
              title="No spaces found"
              message="Try a different search or category."
            />
          ) : (
            <EmptyState
              icon={Boxes}
              title="No listed spaces"
              message="Public spaces appear here once listed."
            />
          )
        }
      />
    </View>
  );
}

function RowSeparator() {
  return <View className="h-2.5" />;
}

function SpaceRowSkeleton() {
  return (
    <View className="flex-row items-center gap-3 rounded-xl bg-card p-4">
      <SkeletonCircle size={48} />
      <View className="flex-1 gap-2">
        <Skeleton className="h-3.5 w-32" />
        <SkeletonText lines={1} />
      </View>
    </View>
  );
}
