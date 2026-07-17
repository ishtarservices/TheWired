import { useEffect, useMemo, useState } from "react";
import { useNavigation } from "@react-navigation/native";
import { Check, Zap } from "lucide-react-native";
import { ActivityIndicator, Modal, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NostrEvent } from "@thewired/shared-types";

import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
import { getStoredWallet, sendZap } from "@/lib/lightning/zapService";
import { haptics } from "@/lib/haptics";
import { DEFAULT_RELAYS } from "@/lib/nostr/engine";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Zap sheet (W6): send sats to a person as a tip — user-to-user value, never
// a purchase (App Store 3.1.1: nothing in the app is lightning-gated).
// Guests and wallet-less users get pointed at the right next step instead of
// a dead end.

const PRESETS = [21, 100, 500, 2100];

export interface ZapTarget {
  recipientPubkey: string;
  /** Zapping a specific note (else the profile). */
  event?: NostrEvent;
}

export function ZapSheet({
  target,
  onClose,
}: {
  target: ZapTarget | null;
  onClose: () => void;
}) {
  const engine = useEngine();
  const navigation = useNavigation();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const isGuest = useAppSelector((s) => s.identity.status === "guest");
  const myPubkey = useAppSelector((s) => s.identity.pubkey);
  const profile = useAppSelector((s) =>
    target ? s.profiles.byPubkey[target.recipientPubkey] : undefined,
  );

  const [amount, setAmount] = useState<number>(PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [comment, setComment] = useState("");
  const [phase, setPhase] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hasWallet, setHasWallet] = useState<boolean | null>(null);

  const visible = target !== null;
  const name = target ? profileDisplayName(profile, target.recipientPubkey) : "";
  const lud16 = profile?.lud16;
  const lud06 = profile?.lud06;

  useEffect(() => {
    if (!visible) return;
    setPhase("idle");
    setError(null);
    setCustom("");
    setComment("");
    getStoredWallet(engine.getAdapters()).then((w) => setHasWallet(!!w));
  }, [visible, engine]);

  const effectiveAmount = useMemo(() => {
    const parsed = parseInt(custom, 10);
    return custom.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : amount;
  }, [custom, amount]);

  const send = () => {
    if (!target) return;
    setPhase("sending");
    setError(null);
    haptics.tap();
    sendZap({
      adapters: engine.getAdapters(),
      recipientPubkey: target.recipientPubkey,
      amountSats: effectiveAmount,
      comment: comment.trim() || undefined,
      event: target.event,
      lud16,
      lud06,
      receiptRelays: DEFAULT_RELAYS,
    })
      .then(() => {
        haptics.success();
        setPhase("done");
        setTimeout(onClose, 1400);
      })
      .catch((e) => {
        setPhase("idle");
        setError(e instanceof Error ? e.message : "The zap didn't go through.");
      });
  };

  const signedOut = isGuest || !myPubkey;
  const noAddress = !lud16 && !lud06;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        className="flex-1 bg-black/50"
        onPress={onClose}
      />
      <View
        className="rounded-t-3xl px-5 pt-3"
        style={{ backgroundColor: tokens.popover, paddingBottom: insets.bottom + 16 }}
      >
        <View className="items-center pb-2">
          <View className="h-1 w-9 rounded-full" style={{ backgroundColor: tokens.border }} />
        </View>
        <View className="flex-row items-center gap-2 pb-3">
          <Zap size={18} color={tokens.warning} strokeWidth={2} />
          <Type role="headline" className="text-heading" numberOfLines={1}>
            Tip {name}
          </Type>
        </View>

        {signedOut ? (
          <View className="gap-3 pb-2">
            <Type role="caption" className="text-muted">
              Zaps are tips between people — sign in with your key to send one.
            </Type>
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
        ) : hasWallet === false ? (
          <View className="gap-3 pb-2">
            <Type role="caption" className="text-muted">
              Connect a Lightning wallet (NWC) in Settings to send tips.
            </Type>
            <Button
              variant="secondary"
              onPress={() => {
                onClose();
                navigation.navigate("Tabs", {
                  screen: "YouTab",
                  params: { screen: "Settings" },
                });
              }}
            >
              Open Settings
            </Button>
          </View>
        ) : noAddress ? (
          <Type role="caption" className="pb-2 text-muted">
            {name} hasn't set a Lightning address on their profile, so they can't
            receive tips yet.
          </Type>
        ) : phase === "done" ? (
          <View className="items-center gap-2 py-6">
            <Check size={28} color={tokens.success} />
            <Type role="body" weight={600} className="text-heading">
              Sent {effectiveAmount.toLocaleString()} sats
            </Type>
          </View>
        ) : (
          <View className="gap-3 pb-1">
            <View className="flex-row gap-2">
              {PRESETS.map((preset) => {
                const selected = !custom.trim() && amount === preset;
                return (
                  <Pressable
                    key={preset}
                    accessibilityRole="button"
                    onPress={() => {
                      setAmount(preset);
                      setCustom("");
                      haptics.selection();
                    }}
                    // Selected = outline, not fill — the sheet's one primary
                    // fill is the confirm button (one-inversion rule).
                    className={
                      selected
                        ? "flex-1 items-center rounded-xl border border-primary bg-field px-2 py-2.5"
                        : "flex-1 items-center rounded-xl border border-transparent bg-field px-2 py-2.5"
                    }
                  >
                    <Type
                      role="caption"
                      weight={600}
                      tabular
                      className={selected ? "text-heading" : "text-soft"}
                    >
                      {preset.toLocaleString()}
                    </Type>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Custom amount (sats)"
              placeholderTextColor={tokens.faint}
              keyboardType="number-pad"
              className="rounded-xl bg-field px-4 py-2.5"
              style={{ color: tokens.heading }}
            />
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Add a note (optional)"
              placeholderTextColor={tokens.faint}
              className="rounded-xl bg-field px-4 py-2.5"
              style={{ color: tokens.heading }}
            />
            {error ? (
              <Type role="micro" className="text-destructive">
                {error}
              </Type>
            ) : null}
            <Button onPress={send} disabled={phase === "sending"}>
              {phase === "sending" ? (
                <ActivityIndicator size="small" color={tokens.primaryForeground} />
              ) : (
                `Tip ${effectiveAmount.toLocaleString()} sats`
              )}
            </Button>
          </View>
        )}
      </View>
    </Modal>
  );
}
