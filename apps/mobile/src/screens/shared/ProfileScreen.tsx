import { useCallback, useEffect, useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { Ban, Check, Copy, EllipsisVertical, UserRound, Zap } from "lucide-react-native";
import { nip19 } from "nostr-tools";
import { Alert, FlatList, Image, Pressable, View } from "react-native";
import type { NostrEvent } from "@thewired/shared-types";

import { truncateKey } from "@/auth/keys";
import { useScreenInsets } from "@/components/layout/Screen";
import { NoteCard, NoteCardSkeleton } from "@/components/notes/NoteCard";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { ZapSheet, type ZapTarget } from "@/components/zaps/ZapSheet";
import { useEngine } from "@/lib/nostr/EngineContext";
import { haptics } from "@/lib/haptics";
import { safeImageUri } from "@/lib/nostr/noteContent";
import { profileDisplayName } from "@/lib/nostr/profiles";
import type { RootStackParamList } from "@/navigation/types";
import { useBackFallback } from "@/navigation/useBackFallback";
import { blockUser, reportEvent, unblockUser } from "@/store/moderation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Any-pubkey profile (W3): live kind-0 header + their recent notes, both
// fetched on entry. Browsable by guests; the user-level report/block
// moderation surface lives behind the header ellipsis (App Store 1.2).

type Props = NativeStackScreenProps<RootStackParamList, "Profile">;

export function ProfileScreen({ route, navigation }: Props) {
  // Cold-start deep links (npub links) mount this as a single-route state —
  // no parent, no native chevron. "Up" goes to the tabs root.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("Tabs", { screen: "SpacesTab", params: { screen: "SpacesHome" } }), [navigation]),
  );
  const { pubkey } = route.params;
  const engine = useEngine();
  const dispatch = useAppDispatch();
  const { tokens } = useTheme();
  const insets = useScreenInsets({ scroll: true });
  const noteActions = useNoteActions();

  const profile = useAppSelector((s) => s.profiles.byPubkey[pubkey]);
  const isBlocked = useAppSelector((s) => !!s.moderation.mutedPubkeys[pubkey]);
  const [notes, setNotes] = useState<NostrEvent[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [zapTarget, setZapTarget] = useState<ZapTarget | null>(null);

  const npub = useMemo(() => {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return null;
    }
  }, [pubkey]);
  const name = profileDisplayName(profile, pubkey);

  useEffect(() => {
    engine.requestProfiles([pubkey]);
    let cancelled = false;
    engine
      .fetchEvents([{ kinds: [1], authors: [pubkey], limit: 30 }])
      .then((events) => {
        if (cancelled) return;
        setNotes(events.sort((a, b) => b.created_at - a.created_at));
      })
      .catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
  }, [engine, pubkey]);

  const copyNpub = async () => {
    if (!npub) return;
    await Clipboard.setStringAsync(npub);
    haptics.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openUserActions = () => {
    haptics.selection();
    Alert.alert(name, undefined, [
      {
        text: "Report user",
        onPress: () => {
          // User-level report stub — queued locally like note reports.
          dispatch(reportEvent(`user:${pubkey}`));
          haptics.success();
        },
      },
      {
        text: isBlocked ? "Unblock" : "Block user",
        style: "destructive",
        onPress: () => {
          dispatch(isBlocked ? unblockUser(pubkey) : blockUser(pubkey));
          haptics.warning();
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const header = (
    <View className="mb-2">
      {/* Full-bleed banner — the list itself has no horizontal padding now
          (flat NoteCard rows own theirs). */}
      {safeImageUri(profile?.banner) ? (
        <Image
          source={{ uri: safeImageUri(profile?.banner) }}
          className="h-36 w-full"
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View className="h-36 w-full bg-primary-dim" />
      )}
      <View className="-mt-10 px-4">
        <View className="flex-row items-end justify-between">
          <View className="rounded-full border-4 border-background">
            <Avatar uri={profile?.picture} pubkey={pubkey} name={name} size={80} />
          </View>
          <View className="mb-1 flex-row items-center gap-2">
            {profile?.lud16 || profile?.lud06 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Tip ${name}`}
                onPress={() => {
                  haptics.tap();
                  setZapTarget({ recipientPubkey: pubkey });
                }}
                className="h-10 w-10 items-center justify-center rounded-full bg-surface-hover"
              >
                <Zap size={17} color={tokens.warning} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="User actions"
              onPress={openUserActions}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-hover"
            >
              <EllipsisVertical size={18} color={tokens.soft} />
            </Pressable>
          </View>
        </View>

        <Type role="title" className="mt-3 text-heading" numberOfLines={1}>
          {name}
        </Type>
        {profile?.nip05 ? (
          <Type role="caption" className="mt-0.5 text-muted" numberOfLines={1}>
            {profile.nip05}
          </Type>
        ) : null}
        {profile?.about ? (
          <Type role="caption" className="mt-2 leading-5 text-soft" numberOfLines={5}>
            {profile.about}
          </Type>
        ) : null}

        <Pressable
          className="mt-3 min-h-[40px] flex-row items-center gap-2 self-start rounded-full bg-surface px-3.5 py-1.5"
          onPress={copyNpub}
          accessibilityRole="button"
          accessibilityLabel="Copy npub"
        >
          <Type role="mono" className="text-soft">
            {npub ? truncateKey(npub) : truncateKey(pubkey)}
          </Type>
          {copied ? (
            <Check size={13} color={tokens.success} />
          ) : (
            <Copy size={13} color={tokens.muted} />
          )}
        </Pressable>
      </View>
      <SectionHeader label="notes" className="px-4" />
    </View>
  );

  const renderItem = useCallback(
    ({ item }: { item: NostrEvent }) => (
      <NoteCard event={item} onLongPress={noteActions.open} footer={noteActions.footer} />
    ),
    [noteActions.open, noteActions.footer],
  );

  if (isBlocked) {
    return (
      <View className="flex-1 bg-background">
        <EmptyState
          icon={Ban}
          title="You've blocked this user"
          message="Their notes are hidden everywhere on this device."
          action={
            <Button
              variant="secondary"
              onPress={() => {
                dispatch(unblockUser(pubkey));
                haptics.selection();
              }}
            >
              Unblock
            </Button>
          }
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={notes ?? []}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
        }}
        ListEmptyComponent={
          notes === null ? (
            <View>
              {Array.from({ length: 3 }, (_, i) => (
                <NoteCardSkeleton key={i} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={UserRound}
              title="No notes yet"
              message="Nothing from this key on the connected relays."
            />
          )
        }
      />
      {noteActions.sheet}
      <ZapSheet target={zapTarget} onClose={() => setZapTarget(null)} />
    </View>
  );
}
