import { useCallback, useEffect, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import {
  Antenna,
  Check,
  ChevronLeft,
  Link2,
  MessageCircle,
  X,
} from "lucide-react-native";
import { nip19 } from "nostr-tools";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NostrEvent } from "@thewired/shared-types";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ListRow } from "@/components/ui/ListRow";
import { Type } from "@/components/ui/Type";
import { type MySpace, type SpaceChannel } from "@/lib/api/spaces";
import { haptics } from "@/lib/haptics";
import { DEFAULT_RELAYS } from "@/lib/env";
import { useEngine } from "@/lib/nostr/EngineContext";
import { resolveHexPubkey } from "@/lib/nostr/dmEngine";
import { postNoteRefToChannel } from "@/lib/nostr/shareToSpace";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { channelIcon, channelSubtitle } from "@/screens/spaces/channelMeta";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectMySpaces,
  selectMySpacesStatus,
} from "@/store/slices/spaceMetaSlice";
import { ensureSpaceMeta, loadMySpaces } from "@/store/spaceMeta";
import { useTheme } from "@/theme/ThemeContext";

// Share a note: copy its nevent link, forward it into a DM, or post it into
// a space channel (two-step space → text-channel picker). Raw-Modal house
// recipe (ZapSheet/NewMessageSheet). Guests keep copy-link; the DM and space
// rows gate in place with explanatory sublabels (browse stays open, actions
// need a key).

type Step = "menu" | "dm" | "spaces" | "channels" | "sending" | "done";

const DONE_AUTO_CLOSE_MS = 1200;

export function ShareNoteSheet({
  target,
  onClose,
}: {
  target: NostrEvent | null;
  onClose: () => void;
}) {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const engine = useEngine();
  const dispatch = useAppDispatch();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const conversations = useAppSelector((s) => s.dm.conversations);
  const profiles = useAppSelector((s) => s.profiles.byPubkey);
  // Joined spaces from the space-meta cache. The sheet isn't a navigator
  // screen (raw Modal), so no useFocusEffect — loadMySpaces dispatches on
  // step entry instead; the staleness gate keeps repeat opens free.
  const spaces = useAppSelector(selectMySpaces);
  const spacesStatus = useAppSelector(selectMySpacesStatus);
  // A load this sheet triggered that settled without producing a list —
  // the "Couldn't load" + Retry state (status returns to "idle" on failure).
  const spacesError = spaces === null && spacesStatus === "idle";

  const [step, setStep] = useState<Step>("menu");
  const [error, setError] = useState<string | null>(null);
  const [npubInput, setNpubInput] = useState("");
  const [pickedSpace, setPickedSpace] = useState<MySpace | null>(null);
  const [channels, setChannels] = useState<SpaceChannel[] | null>(null);
  const [channelsError, setChannelsError] = useState(false);

  const visible = target !== null;

  // Fresh flow every open (ZapSheet's visibility-reset pattern).
  useEffect(() => {
    if (!target) return;
    setStep("menu");
    setError(null);
    setNpubInput("");
    setPickedSpace(null);
    setChannels(null);
    setChannelsError(false);
  }, [target]);

  const reference = target
    ? `nostr:${nip19.neventEncode({
        id: target.id,
        author: target.pubkey,
        relays: [DEFAULT_RELAYS[0]],
      })}`
    : "";

  const copyLink = () => {
    Clipboard.setStringAsync(reference).catch(() => {});
    haptics.success();
    onClose();
  };

  const loadSpaces = useCallback(() => {
    // Stale-gated — instant when SpacesHome already has the list warm.
    void dispatch(loadMySpaces());
  }, [dispatch]);

  const loadChannels = useCallback(
    (space: MySpace) => {
      setChannels(null);
      setChannelsError(false);
      dispatch(ensureSpaceMeta(space.id))
        .then((meta) => {
          if (!meta || meta.channels === null) {
            setChannelsError(true);
            return;
          }
          setChannels(
            meta.channels
              .filter((c) => c.type === "chat")
              .sort((a, b) => a.position - b.position),
          );
        })
        .catch(() => setChannelsError(true));
    },
    [dispatch],
  );

  const sendToDM = async (pubkey: string) => {
    try {
      setError(null);
      await engine.sendDM(pubkey, reference);
      haptics.success();
      setStep("done");
      setTimeout(onClose, DONE_AUTO_CLOSE_MS);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "The message didn't send.");
    }
  };

  const startFromNpub = () => {
    try {
      const pubkey = resolveHexPubkey(npubInput);
      if (pubkey === myPubkey) {
        setError("That's your own key.");
        return;
      }
      void sendToDM(pubkey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid key.");
    }
  };

  const shareToChannel = async (channel: SpaceChannel) => {
    if (!pickedSpace) return;
    setStep("sending");
    setError(null);
    try {
      const meta = await dispatch(ensureSpaceMeta(pickedSpace.id));
      const detail = meta?.detail;
      if (!detail) throw new Error(meta?.error ?? "Space unavailable.");
      const all = meta.channels ?? [];
      // ChannelScreen's rule: untagged messages route to the default chat
      // channel; when no chat channel is marked default, the picked one is it.
      const isDefaultChannel =
        channel.isDefault || !all.some((c) => c.type === "chat" && c.isDefault);
      await postNoteRefToChannel({
        adapters: engine.getAdapters(),
        relayUrl: detail.hostRelay ?? DEFAULT_RELAYS[0],
        spaceId: pickedSpace.id,
        channelId: channel.id,
        isDefaultChannel,
        content: reference,
      });
      haptics.success();
      setStep("done");
      setTimeout(onClose, DONE_AUTO_CLOSE_MS);
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "The space relay refused it.");
      setStep("channels");
    }
  };

  const back = () => {
    setError(null);
    if (step === "channels") setStep("spaces");
    else setStep("menu");
  };

  const title =
    step === "dm"
      ? "Send as message"
      : step === "spaces"
        ? "Share to a space"
        : step === "channels"
          ? (pickedSpace?.name ?? "Pick a channel")
          : "Share note";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/50"
        onPress={onClose}
      />
      <View
        className="max-h-[75%] rounded-t-3xl px-5 pt-3"
        style={{ backgroundColor: tokens.popover, paddingBottom: insets.bottom + 16 }}
      >
        <View className="items-center pb-2">
          <View className="h-1 w-9 rounded-full" style={{ backgroundColor: tokens.border }} />
        </View>
        <View className="flex-row items-center gap-2 pb-3">
          {step === "dm" || step === "spaces" || step === "channels" ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={8} onPress={back}>
              <ChevronLeft size={20} color={tokens.muted} />
            </Pressable>
          ) : null}
          <Type role="headline" className="flex-1 text-heading" numberOfLines={1}>
            {title}
          </Type>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose}>
            <X size={20} color={tokens.muted} />
          </Pressable>
        </View>

        {step === "menu" ? (
          <View className="gap-1 pb-2">
            <MenuRow
              icon={<Link2 size={18} color={tokens.soft} strokeWidth={1.75} />}
              label="Copy link"
              sublabel="nevent — opens in any nostr client"
              onPress={copyLink}
            />
            <MenuRow
              icon={<MessageCircle size={18} color={tokens.soft} strokeWidth={1.75} />}
              label="Send as message"
              sublabel={isLoggedIn ? "Forward to a conversation" : "Sign in to send messages"}
              disabled={!isLoggedIn}
              onPress={() => setStep("dm")}
            />
            <MenuRow
              icon={<Antenna size={18} color={tokens.soft} strokeWidth={1.75} />}
              label="Share to a space"
              sublabel={isLoggedIn ? "Post into a channel you're in" : "Sign in to post in spaces"}
              disabled={!isLoggedIn}
              onPress={() => {
                setStep("spaces");
                loadSpaces();
              }}
            />
          </View>
        ) : null}

        {step === "dm" ? (
          <View className="pb-2">
            <FlatList
              data={conversations}
              keyExtractor={(item) => item.pubkey}
              style={{ maxHeight: 260 }}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const profile = profiles[item.pubkey];
                const name = profileDisplayName(profile, item.pubkey);
                return (
                  <ListRow
                    title={name}
                    subtitle={item.lastMessagePreview || "…"}
                    leading={<Avatar uri={profile?.picture} name={name} pubkey={item.pubkey} size={40} />}
                    chevron={false}
                    onPress={() => void sendToDM(item.pubkey)}
                    className="rounded-xl"
                  />
                );
              }}
              ListEmptyComponent={
                <Type role="caption" className="pb-2 text-muted">
                  No conversations yet — paste a key below.
                </Type>
              }
            />
            <TextInput
              value={npubInput}
              onChangeText={(text) => {
                setNpubInput(text);
                setError(null);
              }}
              placeholder="npub… or 64-char hex"
              placeholderTextColor={tokens.faint}
              autoCapitalize="none"
              autoCorrect={false}
              className="mt-2 rounded-xl bg-field px-4 py-3"
              style={{ color: tokens.heading }}
              onSubmitEditing={startFromNpub}
            />
            {error ? (
              <Type role="caption" className="mt-2 text-destructive">
                {error}
              </Type>
            ) : null}
            <View className="mt-3">
              <Button variant="secondary" onPress={startFromNpub} disabled={!npubInput.trim()}>
                Send to key
              </Button>
            </View>
          </View>
        ) : null}

        {step === "spaces" ? (
          spacesError ? (
            <View className="gap-3 pb-2">
              <Type role="caption" className="text-muted">
                Couldn't load your spaces.
              </Type>
              <Button variant="secondary" onPress={loadSpaces}>
                Retry
              </Button>
            </View>
          ) : spaces === null ? (
            <ActivityIndicator color={tokens.muted} className="py-6" />
          ) : spaces.length === 0 ? (
            <Type role="caption" className="pb-2 text-muted">
              You haven't joined any spaces yet.
            </Type>
          ) : (
            <FlatList
              data={spaces}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <ListRow
                  title={item.name}
                  subtitle={`${item.memberCount} members`}
                  leading={<Avatar uri={item.picture} name={item.name} pubkey={item.id} size={40} />}
                  onPress={() => {
                    setPickedSpace(item);
                    setStep("channels");
                    loadChannels(item);
                  }}
                  className="rounded-xl"
                />
              )}
            />
          )
        ) : null}

        {step === "channels" ? (
          <View className="pb-2">
            {error ? (
              <Type role="caption" className="pb-2 text-destructive">
                {error}
              </Type>
            ) : null}
            {channelsError ? (
              <View className="gap-3">
                <Type role="caption" className="text-muted">
                  Couldn't load this space's channels.
                </Type>
                <Button variant="secondary" onPress={() => pickedSpace && loadChannels(pickedSpace)}>
                  Retry
                </Button>
              </View>
            ) : channels === null ? (
              <ActivityIndicator color={tokens.muted} className="py-6" />
            ) : channels.length === 0 ? (
              <Type role="caption" className="text-muted">
                This space has no text channels.
              </Type>
            ) : (
              <FlatList
                data={channels}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 320 }}
                renderItem={({ item }) => {
                  const Icon = channelIcon(item.type);
                  return (
                    <ListRow
                      title={`#${item.label}`}
                      subtitle={channelSubtitle(item.type, { slowModeSeconds: item.slowModeSeconds })}
                      leading={<Icon size={18} color={tokens.muted} strokeWidth={1.75} />}
                      chevron={false}
                      onPress={() => void shareToChannel(item)}
                      className="rounded-xl"
                    />
                  );
                }}
              />
            )}
          </View>
        ) : null}

        {step === "sending" ? (
          <View className="items-center gap-3 py-6">
            <ActivityIndicator color={tokens.muted} />
            <Type role="caption" className="text-muted">
              Posting to the space relay…
            </Type>
          </View>
        ) : null}

        {step === "done" ? (
          <View className="items-center gap-3 py-6">
            <Check size={28} color={tokens.heading} strokeWidth={2} />
            <Type role="caption" className="text-muted">
              Shared.
            </Type>
          </View>
        ) : null}

        {!isLoggedIn && step === "menu" ? (
          <View className="mt-2">
            <Button
              variant="secondary"
              onPress={() => {
                onClose();
                navigation.navigate("Login");
              }}
            >
              Sign in
            </Button>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

function MenuRow({
  icon,
  label,
  sublabel,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      className={`flex-row items-center gap-3 rounded-xl px-2 py-3 active:bg-surface-hover ${disabled ? "opacity-40" : ""}`}
      onPress={() => {
        haptics.selection();
        onPress();
      }}
    >
      {icon}
      <View className="flex-1">
        <Type role="body" className="text-heading">
          {label}
        </Type>
        {sublabel ? (
          <Type role="caption" className="text-muted">
            {sublabel}
          </Type>
        ) : null}
      </View>
    </Pressable>
  );
}
