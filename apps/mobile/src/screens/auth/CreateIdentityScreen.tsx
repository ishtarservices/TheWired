import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, Eye, EyeOff, TriangleAlert } from "lucide-react-native";
import { View } from "react-native";

import { generateIdentity } from "@/auth/keys";
import { adoptGeneratedIdentity } from "@/auth/session";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { AnimatedView } from "@/lib/animated";
import { haptics } from "@/lib/haptics";
import { useAppDispatch } from "@/store/hooks";
import { useMotion } from "@/theme/motion";
import { useTheme } from "@/theme/ThemeContext";

export function CreateIdentityScreen() {
  const dispatch = useAppDispatch();
  const { tokens } = useTheme();
  const { entering } = useMotion();

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
    haptics.success();
    setCopied(which);
  };

  const finish = async () => {
    setBusy(true);
    setError(null);
    try {
      await dispatch(adoptGeneratedIdentity(keys));
      haptics.success();
      // No navigation — RootNavigator swaps to the tabs when status flips.
    } catch {
      setError("Couldn't save the key to the device keychain. Try again.");
      setBusy(false);
    }
  };

  return (
    <Screen scroll contentClassName="gap-1 px-5">
      <Type role="caption" className="mb-2 mt-2 leading-5 text-soft">
        Your identity is a key pair. The{" "}
        <Type role="caption" weight={600} className="text-heading">
          public key (npub)
        </Type>{" "}
        is your shareable address. The{" "}
        <Type role="caption" weight={600} className="text-heading">
          secret key (nsec)
        </Type>{" "}
        is the only way to sign in — there is no reset or recovery.
      </Type>

      <AnimatedView entering={entering(0)}>
        <SectionHeader label="public key · share freely" />
        <Card>
          <Type role="mono" className="leading-5 text-body" selectable>
            {keys.npub}
          </Type>
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
            <Type role="caption" weight={500} className="text-body">
              {copied === "npub" ? "Copied" : "Copy npub"}
            </Type>
          </Button>
        </Card>
      </AnimatedView>

      <AnimatedView entering={entering(1)}>
        <SectionHeader label="secret key · never share" />
        <Card>
          <Type role="mono" className="leading-5 text-body">
            {nsecRevealed ? keys.nsec : "nsec1 " + "•".repeat(24)}
          </Type>
          <View className="mt-3 flex-row gap-2">
            <Button size="sm" variant="secondary" onPress={() => setNsecRevealed((v) => !v)}>
              {nsecRevealed ? (
                <EyeOff size={14} color={tokens.soft} />
              ) : (
                <Eye size={14} color={tokens.soft} />
              )}
              <Type role="caption" weight={500} className="text-body">
                {nsecRevealed ? "Hide" : "Reveal"}
              </Type>
            </Button>
            <Button size="sm" variant="secondary" onPress={() => copy("nsec")}>
              {copied === "nsec" ? (
                <Check size={14} color={tokens.success} />
              ) : (
                <Copy size={14} color={tokens.soft} />
              )}
              <Type role="caption" weight={500} className="text-body">
                {copied === "nsec" ? "Copied" : "Copy nsec"}
              </Type>
            </Button>
          </View>
        </Card>
      </AnimatedView>

      <AnimatedView entering={entering(2)} className="mt-4">
        <Card className="flex-row gap-3 bg-surface">
          <TriangleAlert size={18} color={tokens.warning} />
          <Type role="caption" className="flex-1 leading-5 text-soft">
            Back the secret key up somewhere safe (password manager, paper).
            Anyone who has it is you; if you lose it, the identity is gone for
            good. It's also saved to this device's keychain so you stay signed in.
          </Type>
        </Card>
      </AnimatedView>

      {error ? (
        <Type role="caption" className="mt-2 text-destructive">
          {error}
        </Type>
      ) : null}

      <AnimatedView entering={entering(3)} className="mt-5">
        <Button size="lg" disabled={!backedUp} loading={busy} onPress={finish}>
          {backedUp ? "I've backed it up — continue" : "Reveal or copy your key first"}
        </Button>
      </AnimatedView>
    </Screen>
  );
}
