import { useCallback, useEffect, useMemo, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MessageCircle, MessageSquarePlus, X } from "lucide-react-native";
import { FlatList, Modal, Pressable, TextInput, View } from "react-native";

import { SignInGate } from "@/components/auth/SignInGate";
import { useScreenInsets } from "@/components/layout/Screen";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow } from "@/components/ui/ListRow";
import { Pill } from "@/components/ui/Pill";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { resolveHexPubkey } from "@/lib/nostr/dmEngine";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { formatRelativeTime } from "@/lib/time";
import type { MessagesStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import type { DMConversation } from "@/store/slices/dmSlice";
import { useTheme } from "@/theme/ThemeContext";

// The Messages tab (W5): live NIP-17 conversation rows. Guests keep the
// SignInGate — DMs are encrypted to a key by definition.

type Props = NativeStackScreenProps<MessagesStackParamList, "DMList">;

export function DMListScreen({ navigation }: Props) {
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  const engine = useEngine();
  const insets = useScreenInsets({ scroll: true });
  const { tokens } = useTheme();

  const conversations = useAppSelector((s) => s.dm.conversations);
  const profiles = useAppSelector((s) => s.profiles.byPubkey);
  const muted = useAppSelector((s) => s.moderation.mutedPubkeys);
  const [composeOpen, setComposeOpen] = useState(false);

  const visible = useMemo(
    () => conversations.filter((c) => !muted[c.pubkey]),
    [conversations, muted],
  );

  // Backfill kind-0s so rows show names, not hexes.
  const peersKey = useMemo(
    () => visible.map((c) => c.pubkey).sort().join(","),
    [visible],
  );
  useEffect(() => {
    if (peersKey) engine.requestProfiles(peersKey.split(","));
  }, [engine, peersKey]);

  // New-chat entry point lives in the header (calm icon, no Sparkles).
  useEffect(() => {
    if (isGuest) return;
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New message"
          hitSlop={8}
          onPress={() => {
            haptics.tap();
            setComposeOpen(true);
          }}
        >
          <MessageSquarePlus size={22} color={tokens.primary} strokeWidth={1.75} />
        </Pressable>
      ),
    });
  }, [navigation, isGuest, tokens.primary]);

  const openConversation = useCallback(
    (pubkey: string) => navigation.navigate("DMConversation", { pubkey }),
    [navigation],
  );

  const renderRow = useCallback(
    ({ item }: { item: DMConversation }) => {
      const profile = profiles[item.pubkey];
      const name = profileDisplayName(profile, item.pubkey);
      return (
        <ListRow
          title={name}
          subtitle={item.lastMessagePreview || "…"}
          leading={
            <Avatar uri={profile?.picture} name={name} pubkey={item.pubkey} size={44} />
          }
          trailing={
            <View className="items-end gap-1">
              <Type role="micro" tabular className="text-faint">
                {formatRelativeTime(item.lastMessageAt)}
              </Type>
              {item.unreadCount > 0 ? (
                <Pill label={String(item.unreadCount)} tone="primary" />
              ) : null}
            </View>
          }
          chevron={false}
          onPress={() => openConversation(item.pubkey)}
          className="rounded-xl"
        />
      );
    },
    [profiles, openConversation],
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
    <View className="flex-1 bg-background">
      <FlatList
        data={visible}
        keyExtractor={(item) => item.pubkey}
        renderItem={renderRow}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 24,
          paddingHorizontal: 8,
          flexGrow: 1,
        }}
        ListEmptyComponent={
          <EmptyState
            icon={MessageCircle}
            title="No conversations yet"
            message="Messages are end-to-end encrypted (NIP-17). Start one with an npub."
            action={
              <Button variant="secondary" onPress={() => setComposeOpen(true)}>
                New message
              </Button>
            }
          />
        }
      />
      <NewMessageSheet
        visible={composeOpen}
        onClose={() => setComposeOpen(false)}
        onStart={(pubkey) => {
          setComposeOpen(false);
          openConversation(pubkey);
        }}
      />
    </View>
  );
}

/** Paste-an-npub sheet — deliberately minimal (contact search is a later
 *  phase; the exit test needs a way to start a conversation from mobile). */
function NewMessageSheet({
  visible,
  onClose,
  onStart,
}: {
  visible: boolean;
  onClose: () => void;
  onStart: (pubkey: string) => void;
}) {
  const { tokens } = useTheme();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  const start = () => {
    try {
      const pubkey = resolveHexPubkey(input);
      if (pubkey === myPubkey) {
        setError("That's your own key.");
        return;
      }
      setInput("");
      setError(null);
      onStart(pubkey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid key.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/50"
        onPress={onClose}
      />
      <View className="rounded-t-3xl px-5 pb-10 pt-3" style={{ backgroundColor: tokens.popover }}>
        <View className="items-center pb-3">
          <View className="h-1 w-9 rounded-full" style={{ backgroundColor: tokens.border }} />
        </View>
        <View className="flex-row items-center justify-between pb-3">
          <Type role="headline" className="text-heading">
            New message
          </Type>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose}>
            <X size={20} color={tokens.muted} />
          </Pressable>
        </View>
        <TextInput
          value={input}
          onChangeText={(text) => {
            setInput(text);
            setError(null);
          }}
          placeholder="npub… or 64-char hex"
          placeholderTextColor={tokens.faint}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          className="rounded-xl bg-field px-4 py-3 text-heading"
          style={{ color: tokens.heading }}
          onSubmitEditing={start}
        />
        {error ? (
          <Type role="caption" className="mt-2 text-destructive">
            {error}
          </Type>
        ) : null}
        <View className="mt-4">
          <Button onPress={start} disabled={!input.trim()}>
            Start conversation
          </Button>
        </View>
      </View>
    </Modal>
  );
}
