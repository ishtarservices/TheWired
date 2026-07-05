import { useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { KeyboardAvoidingView, Platform, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SignInGate } from "@/components/auth/SignInGate";
import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { haptics } from "@/lib/haptics";
import type { RootStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import { useTheme } from "@/theme/ThemeContext";

// Kind-1 composer sheet (W2). Guests reach it (the FAB never hides) and get
// the sign-in gate here — write actions gate at the ACTION, browsing stays
// open (App Store 5.1.1(v)). Reply/quote modes activate in the next phase.

const MAX_PREVIEW_LENGTH = 800;

type Props = NativeStackScreenProps<RootStackParamList, "Composer">;

export function ComposerScreen({ navigation }: Props) {
  const engine = useEngine();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");

  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isLoggedIn) {
    return (
      <SignInGate
        title="Posting needs an identity"
        message="Notes are signed by your key. Create one or log in — your draft stays on this screen."
      />
    );
  }

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      const confirmed = await engine.publishNote(text);
      haptics.success();
      if (!confirmed) {
        // Kept locally + queued to relays; no need to block the dismissal.
        console.warn("[composer] no relay OK before timeout — note kept locally");
      }
      navigation.goBack();
    } catch (e) {
      haptics.error();
      setError(e instanceof Error ? e.message : "Couldn't publish the note.");
      setPosting(false);
    }
  };

  const remaining = MAX_PREVIEW_LENGTH - text.length;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Top bar — modal has no native header */}
      <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
        <Button variant="ghost" size="sm" haptic={false} onPress={() => navigation.goBack()}>
          Cancel
        </Button>
        <Type role="headline" className="text-heading">
          New note
        </Type>
        <Button
          size="sm"
          disabled={!text.trim() || remaining < 0}
          loading={posting}
          onPress={post}
        >
          Post
        </Button>
      </View>

      <TextInput
        className="flex-1 px-5 py-3 text-base leading-6 text-heading"
        multiline
        autoFocus
        placeholder="What's happening on the wire?"
        placeholderTextColor={tokens.muted}
        value={text}
        onChangeText={(t) => {
          setText(t);
          setError(null);
        }}
        editable={!posting}
        textAlignVertical="top"
        accessibilityLabel="Note text"
      />

      {error ? (
        <Type role="caption" className="px-5 pb-1 text-destructive">
          {error}
        </Type>
      ) : null}

      <View
        className="flex-row items-center justify-between border-t border-border-light px-5 py-2.5"
        style={{ paddingBottom: insets.bottom + 10 }}
      >
        <Type role="micro" className="text-faint">
          posts publicly to your relays
        </Type>
        <Type
          role="micro"
          tabular
          className={remaining < 0 ? "text-destructive" : "text-muted"}
        >
          {remaining}
        </Type>
      </View>
    </KeyboardAvoidingView>
  );
}
