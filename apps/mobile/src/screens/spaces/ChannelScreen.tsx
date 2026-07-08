import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Hash, Send, Users, WifiOff } from "lucide-react-native";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NostrEvent } from "@thewired/shared-types";

import { useScreenInsets } from "@/components/layout/Screen";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { fetchSpaceMemberPubkeys, joinSpace } from "@/lib/api/spaces";
import { cachedSpaceChannels, cachedSpaceDetail, invalidateSpace } from "@/lib/api/spaceCache";
import { haptics } from "@/lib/haptics";
import { createChatSession, type ChatSession } from "@/lib/nostr/chatSession";
import { DEFAULT_RELAYS } from "@/lib/nostr/engine";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useBackFallback } from "@/navigation/useBackFallback";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";
import { buildChatRows, timeLabel, type ChatRow } from "./chatRows";

// Space chat (W6, polished): guest-browsable kind-9 reading over an
// ON-DEMAND socket to the space's hostRelay (opened for this screen, closed
// on leave — the resting set stays at the 3 bootstrap sockets). Messages
// group Discord-style (same author within 5 min) under day separators.
// Posting is the gated action: members compose; logged-in non-members get
// the Join CTA; guests get sign-in buttons. The relay enforces membership
// via NIP-29 h-tag rules.

type Props = NativeStackScreenProps<SpacesStackParamList, "Channel">;

const MAX_MESSAGES = 200;

export function ChannelScreen({ route, navigation }: Props) {
  const { spaceId, channelId } = route.params;
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const insets = useScreenInsets();
  const safe = useSafeAreaInsets();
  const noteActions = useNoteActions();

  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  const profiles = useAppSelector((s) => s.profiles.byPubkey);
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);

  const [messages, setMessages] = useState<NostrEvent[]>([]);
  const [sessionState, setSessionState] = useState<"loading" | "live" | "error">("loading");
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [spaceMode, setSpaceMode] = useState<string>("platform");
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const sessionRef = useRef<ChatSession | null>(null);

  // Deep-linked (single-route) mounts have no parent — "up" goes to the space.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("Space", { spaceId }), [navigation, spaceId]),
  );

  // Members icon → the space's roster.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="View members"
          hitSlop={8}
          onPress={() => {
            haptics.selection();
            navigation.navigate("SpaceMembers", { spaceId });
          }}
        >
          <Users size={20} color={tokens.heading} />
        </Pressable>
      ),
    });
  }, [navigation, spaceId, tokens]);

  // Resolve the space (hostRelay, mode, channel meta), then open the
  // per-screen socket. Falls back to the app relay for platform spaces.
  useEffect(() => {
    let cancelled = false;
    let session: ChatSession | null = null;

    Promise.all([
      cachedSpaceDetail(spaceId),
      cachedSpaceChannels(spaceId).catch(() => []),
    ])
      .then(([detail, channels]) => {
        if (cancelled) return;
        setSpaceMode(detail.spaceMode);
        const channel = channels.find((c) => c.id === channelId);
        navigation.setOptions({ title: `#${channel?.label ?? "chat"}` });
        const isDefaultChannel =
          channel?.isDefault ?? !channels.some((c) => c.type === "chat" && c.isDefault);
        const relayUrl = detail.hostRelay ?? DEFAULT_RELAYS[0];

        session = createChatSession({
          adapters: engine.getAdapters(),
          relayUrl,
          spaceId,
          channelId,
          isDefaultChannel,
          onMessage: (event) => {
            setMessages((prev) => {
              if (prev.some((m) => m.id === event.id)) return prev;
              const next = [...prev, event].sort((a, b) => a.created_at - b.created_at);
              return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
            });
          },
          onStatus: (status) => {
            if (status === "connected") setSessionState("live");
            if (status === "error") setSessionState((s) => (s === "live" ? s : "error"));
          },
        });
        sessionRef.current = session;
      })
      .catch(() => {
        if (!cancelled) setSessionState("error");
      });

    return () => {
      cancelled = true;
      session?.destroy();
      sessionRef.current = null;
    };
  }, [spaceId, channelId, engine, navigation]);

  // Membership → composer vs Join CTA.
  useEffect(() => {
    if (!myPubkey) {
      setIsMember(false);
      return;
    }
    fetchSpaceMemberPubkeys(spaceId)
      .then((pubkeys) => setIsMember(pubkeys.includes(myPubkey)))
      .catch(() => setIsMember(false));
  }, [spaceId, myPubkey]);

  const visible = useMemo(
    () => messages.filter((m) => !muted[m.pubkey]),
    [messages, muted],
  );

  // Day separators + consecutive-author grouping (pure, tested helper).
  const rows = useMemo(() => buildChatRows(visible), [visible]);

  // Backfill kind-0s for chatters.
  const authorsKey = useMemo(
    () => [...new Set(visible.map((m) => m.pubkey))].sort().join(","),
    [visible],
  );
  useEffect(() => {
    if (authorsKey) engine.requestProfiles(authorsKey.split(","));
  }, [engine, authorsKey]);

  // Ascending order, scroll-to-end — NOT an inverted FlatList (persistently
  // blurry under RN 0.86's new architecture).
  const listRef = useRef<FlatList<ChatRow>>(null);

  const send = useCallback(() => {
    const session = sessionRef.current;
    const content = draft.trim();
    if (!session || !content) return;
    setDraft("");
    setSendError(null);
    haptics.tap();
    session.post(content).catch((e) => {
      setSendError(e instanceof Error ? e.message : "Couldn't post.");
    });
  }, [draft]);

  const onJoin = useCallback(() => {
    const signer = engine.getSigner();
    if (!signer) return;
    setJoining(true);
    haptics.tap();
    joinSpace(spaceId, signer)
      .then(() => {
        haptics.success();
        invalidateSpace(spaceId);
        setIsMember(true);
      })
      .catch((e) => setSendError(e instanceof Error ? e.message : "Couldn't join."))
      .finally(() => setJoining(false));
  }, [engine, spaceId]);

  const renderRow = useCallback(
    ({ item }: { item: ChatRow }) => {
      if (item.kind === "day") {
        return (
          <View className="items-center py-3">
            <View className="rounded-full bg-surface px-3 py-1">
              <Type role="micro" weight={500} className="text-muted">
                {item.label}
              </Type>
            </View>
          </View>
        );
      }
      const { event, grouped } = item;
      const profile = profiles[event.pubkey];
      const name = profileDisplayName(profile, event.pubkey);

      if (grouped) {
        // Continuation of the author's run — content only, aligned with the
        // name column (36pt avatar + 12pt gap).
        return (
          <Pressable
            accessibilityRole="button"
            onLongPress={() => noteActions.open(event)}
            delayLongPress={300}
            className="px-4 py-0.5"
          >
            <Type role="body" className="leading-5 text-soft" style={{ marginLeft: 48 }}>
              {event.content}
            </Type>
          </Pressable>
        );
      }

      return (
        <Pressable
          accessibilityRole="button"
          onLongPress={() => noteActions.open(event)}
          delayLongPress={300}
          className="flex-row gap-3 px-4 pb-0.5 pt-2.5"
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => rootNavigation.navigate("Profile", { pubkey: event.pubkey })}
          >
            <Avatar uri={profile?.picture} name={name} pubkey={event.pubkey} size={36} />
          </Pressable>
          <View className="flex-1">
            <View className="flex-row items-baseline gap-2">
              <Type role="caption" weight={600} className="text-heading" numberOfLines={1}>
                {name}
              </Type>
              <Type role="micro" tabular className="text-faint">
                {timeLabel(event.created_at)}
              </Type>
            </View>
            <Type role="body" className="mt-0.5 leading-5 text-soft">
              {event.content}
            </Type>
          </View>
        </Pressable>
      );
    },
    [profiles, noteActions, rootNavigation],
  );

  // Composer / gate, by session status (writes gate at the action — guests
  // still read everything above).
  const canCompose = !!myPubkey && !isGuest && (isMember === true || spaceMode === "nip29");

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.headerHeight}
      className="flex-1 bg-background"
    >
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.key}
        renderItem={renderRow}
        contentContainerStyle={{
          paddingTop: insets.headerHeight + 8,
          paddingBottom: 10,
          flexGrow: 1,
          justifyContent: "flex-end",
        }}
        onContentSizeChange={() => {
          if (rows.length > 0) listRef.current?.scrollToEnd({ animated: false });
        }}
        ListEmptyComponent={
          sessionState === "loading" ? (
            <View className="gap-4 px-4 pt-6">
              {Array.from({ length: 6 }, (_, i) => (
                <View key={i} className="flex-row items-center gap-3">
                  <SkeletonCircle size={36} />
                  <View className="flex-1 gap-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-56" />
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState
              icon={Hash}
              title={sessionState === "error" ? "Relay unreachable" : "No messages yet"}
              message={
                sessionState === "error"
                  ? "Couldn't reach this space's relay. Try again shortly."
                  : "Be the first to say something."
              }
            />
          )
        }
        keyboardDismissMode="interactive"
      />

      {sessionState === "error" && visible.length > 0 ? (
        <View className="mx-3 mb-1 flex-row items-center gap-2 rounded-xl bg-surface px-3 py-2">
          <WifiOff size={13} color={tokens.warning} />
          <Type role="micro" weight={500} className="text-muted">
            Relay unreachable — showing what loaded.
          </Type>
        </View>
      ) : null}

      {sendError ? (
        <View className="px-4 pb-1">
          <Type role="micro" className="text-destructive">
            {sendError}
          </Type>
        </View>
      ) : null}

      <View
        className="border-t border-border-light bg-background px-3 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, safe.bottom, 8) + 6 }}
      >
        {canCompose ? (
          <View className="flex-row items-end gap-2">
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Message this channel"
              placeholderTextColor={tokens.faint}
              multiline
              className="max-h-28 flex-1 rounded-2xl bg-field px-4 py-2.5"
              style={{ color: tokens.heading }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!draft.trim()}
              onPress={send}
              className="h-10 w-10 items-center justify-center rounded-full bg-primary active:opacity-90"
              style={!draft.trim() ? { opacity: 0.4 } : undefined}
            >
              <Send size={18} color={tokens.primaryForeground} strokeWidth={2} />
            </Pressable>
          </View>
        ) : isGuest || !myPubkey ? (
          <View className="flex-row items-center justify-between gap-3 py-1">
            <Type role="caption" className="flex-1 text-muted">
              Sign in to join the conversation.
            </Type>
            <Button size="sm" variant="secondary" onPress={() => rootNavigation.navigate("Login")}>
              Sign in
            </Button>
          </View>
        ) : (
          <View className="flex-row items-center justify-between gap-3 py-1">
            <Type role="caption" className="flex-1 text-muted">
              Join this space to post here.
            </Type>
            <Button size="sm" variant="secondary" onPress={onJoin} loading={joining}>
              Join
            </Button>
          </View>
        )}
      </View>

      {noteActions.sheet}
    </KeyboardAvoidingView>
  );
}
