import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { ClipboardPaste, Eye, EyeOff } from "lucide-react-native";
import { Pressable, TextInput, View } from "react-native";

import { loginWithSecret } from "@/auth/session";
import { Screen } from "@/components/layout/Screen";
import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
import { haptics } from "@/lib/haptics";
import { useAppDispatch } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";
import { MONO_FONT } from "@/theme/typography";

export function LoginScreen() {
  const dispatch = useAppDispatch();
  const { tokens } = useTheme();

  const [input, setInput] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) {
      setInput(text.trim());
      setError(null);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await dispatch(loginWithSecret(input));
      haptics.success();
      // RootNavigator swaps to the tabs when the session status flips.
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't log in with that key.");
      setBusy(false);
    }
  };

  return (
    <Screen scroll contentClassName="gap-4 px-5 pt-2">
      <Type role="caption" className="leading-5 text-soft">
        Paste your{" "}
        <Type role="caption" weight={600} className="text-heading">
          secret key
        </Type>{" "}
        — an <Type role="mono">nsec1…</Type> string or 64 hex characters. It's
        checked on-device and stored only in this device's keychain.
      </Type>

      <View
        className="flex-row items-center gap-2 rounded-xl border bg-field px-4"
        style={{ borderColor: error ? tokens.destructive : tokens.border }}
      >
        <TextInput
          className="flex-1 py-3.5 text-sm text-heading"
          style={{ fontFamily: MONO_FONT }}
          placeholder="nsec1…"
          placeholderTextColor={tokens.muted}
          value={input}
          onChangeText={(t) => {
            setInput(t);
            setError(null);
          }}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          multiline={false}
          onSubmitEditing={submit}
          accessibilityLabel="Secret key"
        />
        <Pressable
          className="min-h-[44px] items-center justify-center px-1"
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? "Hide key" : "Show key"}
        >
          {visible ? (
            <EyeOff size={16} color={tokens.soft} />
          ) : (
            <Eye size={16} color={tokens.soft} />
          )}
        </Pressable>
      </View>

      <Button size="sm" variant="secondary" className="self-start" onPress={paste}>
        <ClipboardPaste size={14} color={tokens.soft} />
        <Type role="caption" weight={500} className="text-body">
          Paste from clipboard
        </Type>
      </Button>

      {error ? (
        <Type role="caption" className="leading-4 text-destructive">
          {error}
        </Type>
      ) : null}

      <Button size="lg" disabled={!input.trim()} loading={busy} onPress={submit}>
        Log in
      </Button>
    </Screen>
  );
}
