import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ban, Copy, Flag, MessageCircle, Send } from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SignInGate } from "@/components/auth/SignInGate";
import { useScreenInsets } from "@/components/layout/Screen";
import { ActionsSheet, type ActionsSheetRef } from "@/components/ui/ActionsSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import type { MessagesStackParamList } from "@/navigation/types";
import { blockUser, reportEvent } from "@/store/moderation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setActiveDMConversation, type DMMessage } from "@/store/slices/dmSlice";
import { useTheme } from "@/theme/ThemeContext";

// One NIP-17 conversation (W5): bubbles (mine right/primary, theirs tonal),
// day separators, a KeyboardAvoiding composer, long-press → actions sheet.

type Props = NativeStackScreenProps<MessagesStackParamList, "DMConversation">;

/** A message row or a day separator. */
type Row =
  | { kind: "message"; message: DMMessage }
  | { kind: "day"; label: string; key: string };

function dayLabel(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? null : { year: "numeric" }),
  });
}

function timeLabel(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DMConversationScreen({ route, navigation }: Props) {
  const { pubkey: peer } = route.params;
  const engine = useEngine();
  const dispatch = useAppDispatch();
  const { tokens } = useTheme();
  const insets = useScreenInsets();
  const safe = useSafeAreaInsets();

  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const messages = useAppSelector((s) => s.dm.messages[peer]);
  const profile = useAppSelector((s) => s.profiles.byPubkey[peer]);
  const blocked = useAppSelector((s) => !!s.moderation.mutedPubkeys[peer]);

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const sheetRef = useRef<ActionsSheetRef>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const [sheetTarget, setSheetTarget] = useState<DMMessage | null>(null);

  const peerName = profileDisplayName(profile, peer);

  useEffect(() => {
    navigation.setOptions({ title: peerName });
  }, [navigation, peerName]);

  useEffect(() => {
    engine.requestProfiles([peer]);
  }, [engine, peer]);

  // Unread bookkeeping: active while focused, cleared on leave.
  useFocusEffect(
    useCallback(() => {
      dispatch(setActiveDMConversation(peer));
      return () => dispatch(setActiveDMConversation(null));
    }, [dispatch, peer]),
  );

  // Ascending order with a day separator before each day's first message.
  // Deliberately NOT an inverted FlatList — the scaleY:-1 trick renders
  // persistently blurry content under RN 0.86's new architecture; we scroll
  // to the end instead.
  const rows = useMemo<Row[]>(() => {
    const list = messages ?? [];
    const out: Row[] = [];
    let lastDay: string | null = null;
    for (const msg of list) {
      const label = dayLabel(msg.createdAt);
      if (label !== lastDay) {
        out.push({ kind: "day", label, key: `day-${msg.wrapId}` });
        lastDay = label;
      }
      out.push({ kind: "message", message: msg });
    }
    return out;
  }, [messages]);

  const send = useCallback(() => {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    setSendError(null);
    haptics.tap();
    engine.sendDM(peer, content).catch((e) => {
      setSendError(e instanceof Error ? e.message : "Couldn't send.");
    });
  }, [draft, engine, peer]);

  const openActions = useCallback((message: DMMessage) => {
    setSheetTarget(message);
    haptics.tap();
    requestAnimationFrame(() => sheetRef.current?.present());
  }, []);

  const sheetActions = useMemo(() => {
    if (!sheetTarget) return [];
    return [
      {
        icon: Copy,
        label: "Copy text",
        onPress: () => {
          Clipboard.setStringAsync(sheetTarget.content).catch(() => {});
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
      {
        icon: Flag,
        label: "Report",
        sublabel: "Queued on this device for now",
        onPress: () => {
          dispatch(reportEvent(sheetTarget.wrapId));
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
      {
        icon: Ban,
        label: `Block ${peerName}`,
        sublabel: "Removes this conversation on this device",
        destructive: true,
        onPress: () => {
          sheetRef.current?.dismiss();
          Alert.alert(
            `Block ${peerName}?`,
            "This conversation is removed and new messages from them are ignored on this device.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Block",
                style: "destructive",
                onPress: () => {
                  dispatch(blockUser(peer));
                  engine.removeDMConversation(peer).catch(() => {});
                  haptics.warning();
                  navigation.goBack();
                },
              },
            ],
          );
        },
      },
    ];
  }, [sheetTarget, peerName, peer, dispatch, engine, navigation]);

  const renderRow = useCallback(
    ({ item }: { item: Row }) => {
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
      const msg = item.message;
      const mine = msg.senderPubkey === myPubkey;
      return (
        <Pressable
          accessibilityRole="button"
          onLongPress={() => openActions(msg)}
          delayLongPress={300}
          className={mine ? "items-end py-1" : "items-start py-1"}
        >
          <View
            className={
              mine
                ? "max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5"
                : "max-w-[80%] rounded-2xl rounded-bl-md bg-card px-3.5 py-2.5"
            }
          >
            <Type
              role="body"
              className={mine ? "text-primary-foreground" : "text-heading"}
            >
              {msg.content}
            </Type>
          </View>
          <View className="mt-0.5 flex-row items-center gap-1.5 px-1">
            <Type role="micro" tabular className="text-faint">
              {timeLabel(msg.createdAt)}
            </Type>
            {mine && msg.status === "pending" ? (
              <Type role="micro" className="text-faint">
                sending…
              </Type>
            ) : null}
            {mine && msg.status === "failed" ? (
              <Type role="micro" className="text-destructive">
                failed — long-press to copy & resend
              </Type>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [myPubkey, openActions],
  );

  if (isGuest) {
    return (
      <SignInGate
        title="Messages need an identity"
        message="Direct messages are encrypted to your key (NIP-17) — there's nothing to read or send without one."
      />
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.headerHeight}
      className="flex-1 bg-background"
    >
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => (item.kind === "day" ? item.key : item.message.wrapId)}
        renderItem={renderRow}
        contentContainerStyle={{
          paddingHorizontal: 14,
          paddingTop: insets.headerHeight + 10,
          paddingBottom: 10,
          flexGrow: 1,
          justifyContent: "flex-end",
        }}
        onContentSizeChange={() => {
          if (rows.length > 0) listRef.current?.scrollToEnd({ animated: false });
        }}
        ListEmptyComponent={
          <EmptyState
            icon={MessageCircle}
            title={`Say hi to ${peerName}`}
            message="Messages are end-to-end encrypted — only the two of you can read them."
          />
        }
        keyboardDismissMode="interactive"
      />

      {blocked ? (
        <View className="px-4 pb-8 pt-2">
          <Type role="caption" className="text-center text-muted">
            You blocked {peerName}. Unblock from their profile to message them.
          </Type>
        </View>
      ) : (
        <View
          className="flex-row items-end gap-2 border-t border-border-light bg-background px-3 pt-2"
          style={{ paddingBottom: Math.max(insets.bottom, safe.bottom, 8) + 6 }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${peerName}`}
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
      )}
      {sendError ? (
        <View className="px-4 pb-2">
          <Type role="micro" className="text-destructive">
            {sendError}
          </Type>
        </View>
      ) : null}

      <ActionsSheet
        ref={sheetRef}
        title={`message with ${peerName}`}
        actions={sheetActions}
      />
    </KeyboardAvoidingView>
  );
}
