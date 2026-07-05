import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, Eye, EyeOff, TriangleAlert } from "lucide-react-native";
import { Platform, ScrollView, Text, View } from "react-native";

import { generateIdentity } from "@/auth/keys";
import { adoptGeneratedIdentity } from "@/auth/session";
import { Button } from "@/components/ui/Button";
import { useAppDispatch } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

export function CreateIdentityScreen() {
  const dispatch = useAppDispatch();
  const { tokens } = useTheme();

  // Generated once per visit; committed to the keychain only on confirm.
  const [keys] = useState(generateIdentity);
  const [nsecRevealed, setNsecRevealed] = useState(false);
  const [copied, setCopied] = useState<"npub" | "nsec" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The user must have at least seen or copied the secret before continuing.
  const backedUp = nsecRevealed || copied === "nsec";

  const copy = async (which: "npub" | "nsec") => {
    await Clipboard.setStringAsync(which === "npub" ? keys.npub : keys.nsec);
    setCopied(which);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await dispatch(adoptGeneratedIdentity(keys));
      // No navigation — RootNavigator swaps to the tabs when status flips.
    } catch {
      setError("Couldn't save the key to the device keychain. Try again.");
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-4 p-5">
      <Text className="text-sm leading-5 text-soft">
        Your identity is a key pair. The{" "}
        <Text className="font-semibold text-heading">public key (npub)</Text> is your
        shareable address. The{" "}
        <Text className="font-semibold text-heading">secret key (nsec)</Text> is the
        only way to sign in — there is no reset or recovery.
      </Text>

      {/* npub */}
      <View className="rounded-lg border border-border bg-card p-4">
        <Text className="text-xs font-medium uppercase text-muted">
          Public key · share freely
        </Text>
        <Text
          className="mt-2 text-xs leading-5 text-body"
          style={{ fontFamily: MONO_FONT }}
        >
          {keys.npub}
        </Text>
        <Button
          className="mt-3 self-start"
          size="sm"
          variant="secondary"
          onPress={() => copy("npub")}
        >
          {copied === "npub" ? (
            <Check size={14} color={tokens.success} />
          ) : (
            <Copy size={14} color={tokens.soft} />
          )}
          <Text className="text-xs text-body">
            {copied === "npub" ? "Copied" : "Copy npub"}
          </Text>
        </Button>
      </View>

      {/* nsec */}
      <View className="rounded-lg border border-border bg-card p-4">
        <Text className="text-xs font-medium uppercase text-muted">
          Secret key · never share
        </Text>
        <Text
          className="mt-2 text-xs leading-5 text-body"
          style={{ fontFamily: MONO_FONT }}
        >
          {nsecRevealed ? keys.nsec : "nsec1 " + "•".repeat(24)}
        </Text>
        <View className="mt-3 flex-row gap-2">
          <Button size="sm" variant="secondary" onPress={() => setNsecRevealed((v) => !v)}>
            {nsecRevealed ? (
              <EyeOff size={14} color={tokens.soft} />
            ) : (
              <Eye size={14} color={tokens.soft} />
            )}
            <Text className="text-xs text-body">{nsecRevealed ? "Hide" : "Reveal"}</Text>
          </Button>
          <Button size="sm" variant="secondary" onPress={() => copy("nsec")}>
            {copied === "nsec" ? (
              <Check size={14} color={tokens.success} />
            ) : (
              <Copy size={14} color={tokens.soft} />
            )}
            <Text className="text-xs text-body">
              {copied === "nsec" ? "Copied" : "Copy nsec"}
            </Text>
          </Button>
        </View>
      </View>

      {/* Warning */}
      <View className="flex-row gap-3 rounded-lg border border-border bg-panel p-4">
        <TriangleAlert size={18} color={tokens.warning} />
        <Text className="flex-1 text-xs leading-5 text-soft">
          Back the secret key up somewhere safe (password manager, paper). Anyone
          who has it is you; if you lose it, the identity is gone for good. It's
          also saved to this device's keychain so you stay signed in.
        </Text>
      </View>

      {error ? <Text className="text-xs text-destructive">{error}</Text> : null}

      <Button size="lg" disabled={!backedUp || busy} onPress={finish}>
        {busy ? "Saving…" : backedUp ? "I've backed it up — continue" : "Reveal or copy your key first"}
      </Button>
    </ScrollView>
  );
}
