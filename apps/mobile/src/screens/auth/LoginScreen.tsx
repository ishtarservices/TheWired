import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { ClipboardPaste, Eye, EyeOff } from "lucide-react-native";
import { Platform, ScrollView, Text, TextInput, View } from "react-native";

import { loginWithSecret } from "@/auth/session";
import { Button } from "@/components/ui/Button";
import { useAppDispatch } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

const MONO_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

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
      // RootNavigator swaps to the tabs when the session status flips.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log in with that key.");
      setBusy(false);
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-5"
      keyboardShouldPersistTaps="handled"
    >
      <Text className="text-sm leading-5 text-soft">
        Paste your <Text className="font-semibold text-heading">secret key</Text> —
        an <Text style={{ fontFamily: MONO_FONT }}>nsec1…</Text> string or 64 hex
        characters. It's checked on-device and stored only in this device's
        keychain.
      </Text>

      <View className="flex-row items-center gap-2 rounded-lg border border-border bg-field px-3">
        <TextInput
          className="flex-1 py-3 text-sm text-heading"
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
        <Button size="sm" variant="ghost" haptic={false} onPress={() => setVisible((v) => !v)}>
          {visible ? <EyeOff size={16} color={tokens.soft} /> : <Eye size={16} color={tokens.soft} />}
        </Button>
      </View>

      <Button size="sm" variant="secondary" className="self-start" onPress={paste}>
        <ClipboardPaste size={14} color={tokens.soft} />
        <Text className="text-xs text-body">Paste from clipboard</Text>
      </Button>

      {error ? <Text className="text-xs leading-4 text-destructive">{error}</Text> : null}

      <Button size="lg" disabled={!input.trim() || busy} onPress={submit}>
        {busy ? "Checking…" : "Log in"}
      </Button>
    </ScrollView>
  );
}
