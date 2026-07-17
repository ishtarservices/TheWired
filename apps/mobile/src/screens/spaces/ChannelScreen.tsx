import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Hash, Send, UsersRound, WifiOff } from "lucide-react-native";
import {
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useScreenInsets } from "@/components/layout/Screen";
import { useNoteActions } from "@/components/notes/useNoteActions";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LiveDot } from "@/components/ui/LiveDot";
import { Skeleton, SkeletonCircle } from "@/components/ui/Skeleton";
import { Type } from "@/components/ui/Type";
import { AnimatedView } from "@/lib/animated";
import { invalidateMembership, isMemberOf } from "@/lib/api/membership";
import { joinSpace } from "@/lib/api/spaces";
import { haptics } from "@/lib/haptics";
import { createChatSession, type ChatSession } from "@/lib/nostr/chatSession";
import { DEFAULT_RELAYS } from "@/lib/nostr/engine";
import { useEngine } from "@/lib/nostr/EngineContext";
import { useBackFallback } from "@/navigation/useBackFallback";
import type { SpacesStackParamList } from "@/navigation/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hydrateChannelBacklog, persistChannelBacklog } from "@/store/spaceChat";
import { ensureSpaceMeta, invalidateSpaceMeta } from "@/store/spaceMeta";
import { markChannelRead } from "@/store/spacePreviews";
import { chatMessageReceived, selectChannelMessages } from "@/store/slices/spaceChatSlice";
import {
  SPACE_META_STALE_SEC,
  selectMySpaces,
  selectMySpacesFetchedAt,
} from "@/store/slices/spaceMetaSlice";
import { channelPreviewsUpserted } from "@/store/slices/spacePreviewsSlice";
import { SHADOWS } from "@/theme/constants";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";
import { buildChatRows, type ChatRow } from "./chatRows";
import { isNearBottom } from "./chatScroll";
import { ChatMessageRow } from "./components/ChatMessageRow";

// Space chat (W6, polished): guest-browsable kind-9 reading over an
// ON-DEMAND socket to the space's hostRelay (opened for this screen, closed
// on leave — the resting set stays at the 3 bootstrap sockets). Messages
// group Discord-style (same author within 5 min) under day separators.
// Posting is the gated action: members compose; logged-in non-members get
// the Join CTA; guests get sign-in buttons. The relay enforces membership
// via NIP-29 h-tag rules.
//
// Messages live in the spaceChat slice and hydrate from SQLite before the
// socket dials (dm/feed parity) — re-entering a channel paints instantly;
// the live backlog merges by event id with deterministic ordering.

type Props = NativeStackScreenProps<SpacesStackParamList, "Channel">;

const PERSIST_DEBOUNCE_MS = 400;

export function ChannelScreen({ route, navigation }: Props) {
  const { spaceId, channelId } = route.params;
  const rootNavigation = useNavigation();
  const engine = useEngine();
  const { tokens } = useTheme();
  const insets = useScreenInsets();
  const safe = useSafeAreaInsets();
  const noteActions = useNoteActions();

  const dispatch = useAppDispatch();
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  // Ref, not an effect dep — the session effect's deps mustn't grow (a
  // socket teardown per identity flicker), same contract as mutedRef.
  const myPubkeyRef = useRef(myPubkey);
  myPubkeyRef.current = myPubkey;

  const messages = useAppSelector((s) => selectChannelMessages(s, spaceId, channelId));
  const [sessionState, setSessionState] = useState<"loading" | "live" | "error">("loading");
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [spaceMode, setSpaceMode] = useState<string>("platform");
  const [channelLabel, setChannelLabel] = useState(channelId);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const sessionRef = useRef<ChatSession | null>(null);

  // Deep-linked (single-route) mounts have no parent — "up" goes to the space.
  useBackFallback(
    navigation,
    useCallback(() => navigation.replace("Space", { spaceId }), [navigation, spaceId]),
  );

  // Members icon → the space's roster (a clean single glyph — anything
  // overlaid gets swallowed by the iOS 26 Liquid-Glass header circle and
  // reads as an artifact). The liveness dot lives beside the TITLE instead:
  // it's the channel connection that's live, and the title row is the one
  // header region the glass treatment leaves alone.
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
          {/* UsersRound, not Users — Users' second figure is a detached
              crescent that reads as a broken glyph at header sizes. */}
          <UsersRound size={20} color={tokens.heading} strokeWidth={1.75} />
        </Pressable>
      ),
      headerTitle: () => (
        <View className="flex-row items-center gap-2">
          <Type
            role="headline"
            weight={600}
            className="text-heading"
            style={{ fontSize: 17 }}
            numberOfLines={1}
          >
            #{channelLabel}
          </Type>
          {sessionState === "live" ? <LiveDot size={5} /> : null}
        </View>
      ),
    });
  }, [navigation, spaceId, tokens, sessionState, channelLabel]);

  // Cached backlog first — the SQLite read races the socket dial below, so
  // a previously visited channel paints before the relay answers.
  useEffect(() => {
    dispatch(hydrateChannelBacklog(spaceId, channelId));
  }, [dispatch, spaceId, channelId]);

  // Write-through, debounced: a backlog trickle collapses to ~1 row write;
  // unmount flushes (safe after identity clear — the thunk empty-guards).
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedulePersist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      persistTimer.current = null;
      dispatch(persistChannelBacklog(spaceId, channelId));
    }, PERSIST_DEBOUNCE_MS);
  }, [dispatch, spaceId, channelId]);
  useEffect(
    () => () => {
      if (persistTimer.current) {
        clearTimeout(persistTimer.current);
        persistTimer.current = null;
      }
      dispatch(persistChannelBacklog(spaceId, channelId));
    },
    [dispatch, spaceId, channelId],
  );

  // Resolve the space (hostRelay, mode, channel meta), then open the
  // per-screen socket. Falls back to the app relay for platform spaces.
  // ensureSpaceMeta answers instantly from the cache on revisits — the
  // socket dials without waiting on the backend.
  useEffect(() => {
    let cancelled = false;
    let session: ChatSession | null = null;

    dispatch(ensureSpaceMeta(spaceId))
      .then((meta) => {
        if (cancelled) return;
        const detail = meta?.detail;
        if (!detail) {
          setSessionState("error");
          return;
        }
        const channels = meta.channels ?? [];
        setSpaceMode(detail.spaceMode);
        const channel = channels.find((c) => c.id === channelId);
        // `title` stays for the back-label/a11y; the visible title is the
        // custom headerTitle above (label + liveness dot).
        setChannelLabel(channel?.label ?? "chat");
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
            dispatch(chatMessageReceived({ spaceId, channelId, event }));
            schedulePersist();
            // Feed the SpacesHome preview row — muted authors never surface
            // (the reducer can't read the moderation slice; filter here).
            // isOwn keeps our optimistic echo out of the unread count; the
            // slice dedups by event id against the space-signal sub.
            if (!mutedRef.current[event.pubkey]) {
              dispatch(
                channelPreviewsUpserted([
                  {
                    spaceId,
                    channelId,
                    eventId: event.id,
                    createdAt: event.created_at,
                    senderPubkey: event.pubkey,
                    content: event.content,
                    isOwn: event.pubkey === myPubkeyRef.current,
                  },
                ]),
              );
            }
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
    // schedulePersist's own deps are a subset of this effect's, so its
    // identity is stable here — no extra socket teardowns.
  }, [spaceId, channelId, engine, navigation, dispatch, schedulePersist]);

  // Viewing the channel reads it — on entry, and again on leave so messages
  // that arrived while open count as read.
  useEffect(() => {
    dispatch(markChannelRead(spaceId, channelId));
    return () => {
      dispatch(markChannelRead(spaceId, channelId));
    };
  }, [dispatch, spaceId, channelId]);

  // B1 — per-screen socket lifecycle. iOS kills the socket seconds after
  // backgrounding; without this the pool's backoff keeps redialing in the
  // background (the exact waste suspend() exists to prevent). Screen-scoped
  // AppState listener (MobileLifecycleController idiom), NOT a registration
  // with the global controller — this session dies on unmount. Resume
  // replays the kind-9 REQ (limit-60 window), so the foreground return
  // catches up on the backlog; a NIP-42 re-challenge flows through the
  // session's existing onAuth. Backgrounding also marks the channel read —
  // the user was looking at these messages when they left.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        sessionRef.current?.resume();
      } else {
        sessionRef.current?.suspend();
        dispatch(markChannelRead(spaceId, channelId));
      }
    });
    return () => sub.remove();
  }, [dispatch, spaceId, channelId]);

  // Membership → composer vs Join CTA. B7 fix: never flash the Join CTA at
  // a member off one flaky response — a fresh joined list short-circuits
  // without touching the network, real failures get a bounded retry, and
  // the composer stays neutral ("checking membership…") until resolved.
  const mySpaces = useAppSelector(selectMySpaces);
  const mySpacesFetchedAt = useAppSelector(selectMySpacesFetchedAt);
  useEffect(() => {
    setIsMember(null);
  }, [spaceId, myPubkey]);
  useEffect(() => {
    if (!myPubkey) {
      setIsMember(false);
      return;
    }
    // Positive shortcut: the joined list is authoritative when fresh.
    const now = Math.floor(Date.now() / 1000);
    if (
      now - mySpacesFetchedAt < SPACE_META_STALE_SEC &&
      mySpaces?.some((s) => s.id === spaceId)
    ) {
      setIsMember(true);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempt = (retriesLeft: number) => {
      isMemberOf(spaceId, myPubkey)
        .then((member) => {
          if (!cancelled) setIsMember(member);
        })
        .catch(() => {
          // Retry on THROW only — a clean "not in the roster" answer above
          // is final. 2 retries at 1s/4s, then fail closed.
          if (cancelled) return;
          if (retriesLeft > 0) {
            const delay = retriesLeft === 2 ? 1000 : 4000;
            timer = setTimeout(() => attempt(retriesLeft - 1), delay);
          } else {
            setIsMember(false);
          }
        });
    };
    attempt(2);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId, myPubkey, mySpaces, mySpacesFetchedAt]);

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

  // B2 — no yank while reading history. Auto-scroll on content growth ONLY
  // while the reader is pinned near the bottom (tracked in a ref via
  // onScroll) or right after their own send; otherwise new arrivals raise a
  // quiet "new messages" chip (W9 new-notes-pill register) instead of
  // stealing the viewport. Mount still lands at the bottom: nearBottom
  // starts true, so the hydrate/backlog paints scroll-to-end as before.
  const nearBottomRef = useRef(true);
  const ownSendScrollRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);

  useEffect(() => {
    // Params can change in place (navigate to a sibling channel) — reset the
    // scroll bookkeeping with the message list.
    nearBottomRef.current = true;
    ownSendScrollRef.current = false;
    prevMessageCountRef.current = 0;
    setUnseenCount(0);
  }, [spaceId, channelId]);

  const onListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const near = isNearBottom(e.nativeEvent);
    nearBottomRef.current = near;
    if (near) setUnseenCount(0); // reached the bottom — chip retires
  }, []);

  const onListContentSizeChange = useCallback(() => {
    if (rows.length === 0) return;
    if (nearBottomRef.current || ownSendScrollRef.current) {
      ownSendScrollRef.current = false;
      nearBottomRef.current = true; // the scroll below lands at the bottom
      listRef.current?.scrollToEnd({ animated: false });
      setUnseenCount(0);
    }
  }, [rows.length]);

  // Count appended messages while scrolled up — the chip's label. Own sends
  // don't count (their auto-scroll clears the chip in the same frame anyway).
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = visible.length;
    if (visible.length > prev && !nearBottomRef.current && !ownSendScrollRef.current) {
      setUnseenCount((c) => c + (visible.length - prev));
    }
  }, [visible.length]);

  const scrollToLatest = useCallback(() => {
    nearBottomRef.current = true;
    setUnseenCount(0);
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  const send = useCallback(() => {
    const session = sessionRef.current;
    const content = draft.trim();
    if (!session || !content) return;
    setDraft("");
    setSendError(null);
    haptics.tap();
    // Own sends always scroll — even from deep in history (B2).
    ownSendScrollRef.current = true;
    session.post(content).catch((e) => {
      ownSendScrollRef.current = false; // no echo coming — don't yank later
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
        setIsMember(true);
        invalidateMembership(spaceId);
        dispatch(invalidateSpaceMeta(spaceId));
      })
      .catch((e) => setSendError(e instanceof Error ? e.message : "Couldn't join."))
      .finally(() => setJoining(false));
  }, [engine, spaceId, dispatch]);

  // B3 — rows are store-connected (ChatMessageRow selects only its sender's
  // profile), so renderRow must NOT depend on the profiles map: a kind-0
  // arrival re-renders the touched author's rows, not the whole list.
  // noteActions.open is a stable useCallback; onPressAuthor pins navigation.
  const onPressAuthor = useCallback(
    (pubkey: string) => rootNavigation.navigate("Profile", { pubkey }),
    [rootNavigation],
  );
  const openMessageActions = noteActions.open;

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
      return (
        <ChatMessageRow
          event={item.event}
          grouped={item.grouped}
          onLongPress={openMessageActions}
          onPressAuthor={onPressAuthor}
        />
      );
    },
    [openMessageActions, onPressAuthor],
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
      <View className="flex-1">
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
          onScroll={onListScroll}
          scrollEventThrottle={16}
          onContentSizeChange={onListContentSizeChange}
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

        {unseenCount > 0 ? (
          <NewMessagesChip count={unseenCount} onPress={scrollToLatest} />
        ) : null}
      </View>

      {sessionState === "error" && visible.length > 0 ? (
        // Status without color: mono text on a hairline-bordered surface.
        <View className="mx-3 mb-1 flex-row items-center gap-2 rounded-xl border border-border-light px-3 py-2">
          <WifiOff size={13} color={tokens.muted} />
          <Type role="meta" className="text-muted">
            relay unreachable — showing what loaded
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
        ) : isMember === null ? (
          // Membership unresolved — neutral state, never a premature Join
          // CTA at someone who may well be a member (B7).
          <View className="flex-row items-center justify-between gap-3 py-1">
            <Type role="caption" className="flex-1 text-muted">
              checking membership…
            </Type>
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

// Floating catch-up affordance while the reader is up in history — the
// NewNotesPill register (quiet protocol voice on a raised panel, hairline
// border, no primary fill), bottom-anchored above the composer.
function NewMessagesChip({ count, onPress }: { count: number; onPress: () => void }) {
  const { tokens } = useTheme();
  const motion = useMotion();
  const label = `${count > 99 ? "99+" : count} new message${count === 1 ? "" : "s"}`;

  return (
    <AnimatedView
      // entering= is undefined under reduce-motion (safe XOR combo:
      // AnimatedView + className + entering — no useAnimatedStyle here).
      entering={motion.fade()}
      pointerEvents="box-none"
      className="absolute bottom-2 left-0 right-0 items-center"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} — scroll to latest`}
        onPress={() => {
          haptics.selection();
          onPress();
        }}
        className="rounded-full bg-panel px-3.5 py-1.5 active:opacity-80"
        style={[
          { borderWidth: StyleSheet.hairlineWidth, borderColor: tokens.border },
          SHADOWS.md,
        ]}
      >
        <Type role="metaLabel" className="lowercase text-soft">
          {label} ↓
        </Type>
      </Pressable>
    </AnimatedView>
  );
}
