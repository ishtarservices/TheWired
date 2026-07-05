import { useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { nip19 } from "nostr-tools";
import { Platform, Text, View } from "react-native";

import { logout } from "@/auth/session";
import { truncateKey } from "@/auth/keys";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type { YouStackParamList } from "@/navigation/types";
import { PlaceholderScreen } from "@/screens/PlaceholderScreen";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const SIGNER_LABELS: Record<string, string> = {
  local_nsec: "Device key (keychain)",
  nip46: "Remote signer (NIP-46)",
  native_keystore: "Native keystore",
};

type Props = NativeStackScreenProps<YouStackParamList, "You">;

export function YouScreen({ navigation }: Props) {
  // Profile lives on the root stack (typed via RootParamList).
  const rootNavigation = useNavigation();
  const dispatch = useAppDispatch();
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const signerType = useAppSelector((s) => s.identity.signerType);
  const isOnline = useAppSelector((s) => s.lifecycle.isOnline);
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const npub = useMemo(() => (pubkey ? nip19.npubEncode(pubkey) : null), [pubkey]);

  const copyNpub = async () => {
    if (!npub) return;
    await Clipboard.setStringAsync(npub);
    setCopiedNpub(true);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    await dispatch(logout());
    // RootNavigator swaps back to the auth screens on state change.
  };

  return (
    <PlaceholderScreen
      title="You"
      description="Own profile + account switcher — profile metadata (kind 0) loads once the relay pool lands."
    >
      <View className="flex-row items-center gap-3 rounded-lg border border-border bg-card p-4">
        <Avatar pubkey={pubkey ?? undefined} name={npub ?? "?"} size={48} />
        <View className="flex-1">
          <Text className="text-sm font-semibold text-heading" style={{ fontFamily: MONO_FONT }}>
            {npub ? truncateKey(npub) : "—"}
          </Text>
          <Text className="mt-0.5 text-xs text-muted">
            {isOnline ? "Online" : "Offline"} ·{" "}
            {signerType ? SIGNER_LABELS[signerType] : "no signer"}
          </Text>
        </View>
      </View>

      <Button variant="secondary" onPress={copyNpub}>
        {copiedNpub ? "Copied!" : "Copy npub"}
      </Button>
      <Button variant="secondary" onPress={() => navigation.navigate("Settings")}>
        Settings →
      </Button>
      <Button
        variant="ghost"
        onPress={() => pubkey && rootNavigation.navigate("Profile", { pubkey })}
      >
        View public profile (root push)
      </Button>
      <Button variant="destructive" disabled={loggingOut} onPress={handleLogout}>
        {loggingOut ? "Logging out…" : "Log out"}
      </Button>
      <Text className="text-center text-[11px] leading-4 text-muted">
        Logging out removes the secret key from this device's keychain. Make
        sure it's backed up — there's no recovery.
      </Text>
    </PlaceholderScreen>
  );
}
