import { useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, LogOut, Settings as SettingsIcon, UserRound } from "lucide-react-native";
import { nip19 } from "nostr-tools";
import { Image, Pressable, View } from "react-native";

import { logout } from "@/auth/session";
import { truncateKey } from "@/auth/keys";
import { Screen } from "@/components/layout/Screen";
import { SignInGate } from "@/components/auth/SignInGate";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ListRow } from "@/components/ui/ListRow";
import { Pill } from "@/components/ui/Pill";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { safeImageUri } from "@/lib/nostr/noteContent";
import type { YouStackParamList } from "@/navigation/types";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

const SIGNER_LABELS: Record<string, string> = {
  local_nsec: "device key",
  nip46: "remote signer",
  native_keystore: "native keystore",
};

type Props = NativeStackScreenProps<YouStackParamList, "You">;

export function YouScreen({ navigation }: Props) {
  // Profile lives on the root stack (typed via RootParamList).
  const rootNavigation = useNavigation();
  const dispatch = useAppDispatch();
  const { tokens } = useTheme();
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const signerType = useAppSelector((s) => s.identity.signerType);
  // Live kind-0 — the engine keeps an own-profile subscription while logged in.
  const profile = useAppSelector((s) =>
    pubkey ? s.profiles.byPubkey[pubkey] : undefined,
  );
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const npub = useMemo(() => (pubkey ? nip19.npubEncode(pubkey) : null), [pubkey]);
  const displayName = profile?.display_name?.trim() || profile?.name?.trim();

  const copyNpub = async () => {
    if (!npub) return;
    await Clipboard.setStringAsync(npub);
    haptics.success();
    setCopiedNpub(true);
    setTimeout(() => setCopiedNpub(false), 2000);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await dispatch(logout());
    // RootNavigator swaps back to the auth screens on state change.
  };

  if (isGuest) {
    // Sign-in gate, but Settings stays reachable — theming isn't an
    // account feature and shouldn't be locked behind one (5.1.1 spirit).
    return (
      <Screen>
        <SignInGate
          title="You're browsing as a guest"
          message="Create an identity or log in to have a profile, post, follow people, and send messages."
        />
        <View className="px-6 pb-4">
          <Button variant="ghost" onPress={() => navigation.navigate("Settings")}>
            Settings
          </Button>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll contentClassName="px-5">
      {/* Identity card — live kind-0 (name/avatar/banner) over the key. */}
      <Card className="items-center overflow-hidden p-0 pb-7">
        {safeImageUri(profile?.banner) ? (
          <Image
            source={{ uri: safeImageUri(profile?.banner) }}
            className="h-24 w-full"
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View className="h-24 w-full bg-primary-dim" />
        )}
        <View className="-mt-9 items-center px-5">
          <View className="rounded-full border-4 border-card">
            <Avatar
              uri={profile?.picture}
              pubkey={pubkey ?? undefined}
              name={displayName ?? npub ?? "?"}
              size={76}
            />
          </View>
          {displayName ? (
            <Type role="title" className="mt-3 text-center text-heading" numberOfLines={1}>
              {displayName}
            </Type>
          ) : null}
          {profile?.nip05 ? (
            <Type role="caption" className="mt-0.5 text-muted" numberOfLines={1}>
              {profile.nip05}
            </Type>
          ) : null}
          {profile?.about ? (
            <Type
              role="caption"
              className="mt-2 max-w-[300px] text-center leading-5 text-soft"
              numberOfLines={3}
            >
              {profile.about}
            </Type>
          ) : null}
          <Pressable
            className="mt-4 min-h-[44px] flex-row items-center gap-2 rounded-full bg-surface px-4 py-2"
            onPress={copyNpub}
            accessibilityRole="button"
            accessibilityLabel="Copy npub"
          >
            <Type role="monoLg" className="text-body">
              {npub ? truncateKey(npub) : "—"}
            </Type>
            {copiedNpub ? (
              <Check size={14} color={tokens.success} />
            ) : (
              <Copy size={14} color={tokens.muted} />
            )}
          </Pressable>
          <View className="mt-3 flex-row gap-2">
            <Pill
              label={signerType ? SIGNER_LABELS[signerType] ?? signerType : "no signer"}
              tone="primary"
            />
          </View>
        </View>
      </Card>

      <SectionHeader label="account" />
      <Card className="p-0">
        <ListRow
          title="Public profile"
          subtitle="How others see you"
          leading={<UserRound size={20} color={tokens.soft} strokeWidth={1.75} />}
          onPress={() => pubkey && rootNavigation.navigate("Profile", { pubkey })}
        />
        <View className="mx-4 h-px bg-border-light" />
        <ListRow
          title="Settings"
          subtitle="Theme, relays, features"
          leading={<SettingsIcon size={20} color={tokens.soft} strokeWidth={1.75} />}
          onPress={() => navigation.navigate("Settings")}
        />
      </Card>

      <SectionHeader label="session" />
      <Card className="p-0">
        <ListRow
          title={loggingOut ? "Logging out…" : "Log out"}
          leading={<LogOut size={20} color={tokens.destructive} strokeWidth={1.75} />}
          destructive
          chevron={false}
          onPress={loggingOut ? undefined : handleLogout}
        />
      </Card>
      <Type role="micro" className="mt-3 px-4 text-center leading-4 text-faint">
        Logging out removes the secret key from this device's keychain. Make
        sure it's backed up — there's no recovery.
      </Type>
    </Screen>
  );
}
