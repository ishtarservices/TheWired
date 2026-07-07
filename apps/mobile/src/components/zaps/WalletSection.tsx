import { useEffect, useState } from "react";
import { Wallet2, X } from "lucide-react-native";
import { Pressable, TextInput, View } from "react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { NWC_SECRET_KEY, parseNwcUri, type ParsedNwc } from "@/lib/lightning/nwc";
import { useEngine } from "@/lib/nostr/EngineContext";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Settings → Wallet (W6): paste a nostr+walletconnect:// URI to enable zaps
// (user-to-user tips). SECURITY CONTRACT: the URI is a spending credential —
// it lives ONLY in SecureStore (OS keychain), never Redux, never SQLite.

export function WalletSection() {
  const engine = useEngine();
  const { tokens } = useTheme();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");

  const [wallet, setWallet] = useState<ParsedNwc | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    engine
      .getAdapters()
      .secretStore.getSecret(NWC_SECRET_KEY)
      .then((uri) => {
        if (uri) {
          try {
            setWallet(parseNwcUri(uri));
          } catch {
            setWallet(null);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [engine]);

  if (!isLoggedIn) return null;

  const connect = async () => {
    setError(null);
    try {
      const parsed = parseNwcUri(input);
      await engine.getAdapters().secretStore.setSecret(NWC_SECRET_KEY, input.trim());
      setWallet(parsed);
      setInput("");
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid wallet URI.");
    }
  };

  const disconnect = async () => {
    await engine.getAdapters().secretStore.deleteSecret(NWC_SECRET_KEY).catch(() => {});
    setWallet(null);
    haptics.selection();
  };

  return (
    <>
      <SectionHeader label="wallet" />
      <Card>
        {!loaded ? null : wallet ? (
          <View>
            <View className="flex-row items-center gap-2.5">
              <Wallet2 size={18} color={tokens.primary} />
              <View className="flex-1">
                <Type role="body" weight={500} className="text-heading">
                  Wallet connected
                </Type>
                <Type role="micro" className="mt-0.5 text-muted" numberOfLines={1}>
                  {wallet.lud16 ?? new URL(wallet.relayUrl).hostname}
                </Type>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Disconnect wallet"
                onPress={disconnect}
                hitSlop={8}
                className="h-8 w-8 items-center justify-center rounded-full bg-surface"
              >
                <X size={15} color={tokens.muted} />
              </Pressable>
            </View>
            <Type role="micro" className="mt-2.5 leading-4 text-faint">
              Used only for zaps — tips you choose to send to other people.
              The connection secret stays in the device keychain.
            </Type>
          </View>
        ) : (
          <View>
            <Type role="caption" className="leading-5 text-muted">
              Connect a Lightning wallet with Nostr Wallet Connect to tip
              people (zaps). Paste the nostr+walletconnect:// URI from your
              wallet app.
            </Type>
            <TextInput
              value={input}
              onChangeText={(text) => {
                setInput(text);
                setError(null);
              }}
              placeholder="nostr+walletconnect://…"
              placeholderTextColor={tokens.faint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              className="mt-3 rounded-xl bg-field px-4 py-2.5"
              style={{ color: tokens.heading }}
            />
            {error ? (
              <Type role="micro" className="mt-2 text-destructive">
                {error}
              </Type>
            ) : null}
            <View className="mt-3">
              <Button variant="secondary" size="sm" onPress={connect} disabled={!input.trim()}>
                Connect wallet
              </Button>
            </View>
          </View>
        )}
      </Card>
    </>
  );
}
