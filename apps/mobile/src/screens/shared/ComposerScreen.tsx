import { useEffect, useState } from "react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NostrEvent } from "@thewired/shared-types";

import { SignInGate } from "@/components/auth/SignInGate";
import { Button } from "@/components/ui/Button";
import { Type } from "@/components/ui/Type";
import { useEngine } from "@/lib/nostr/EngineContext";
import { haptics } from "@/lib/haptics";
import { parseThreadRef } from "@/lib/nostr/noteTags";
import { profileDisplayName } from "@/lib/nostr/profiles";
import type { RootStackParamList } from "@/navigation/types";
import { useAppSelector } from "@/store/hooks";
import { selectFeedEvent } from "@/store/slices/feedSlice";
import { useTheme } from "@/theme/ThemeContext";

// Kind-1 composer sheet (W2 + reply mode). Guests reach it (the FAB never
// hides) and get the sign-in gate here — write actions gate at the ACTION,
// browsing stays open (App Store 5.1.1(v)). Reply mode threads with NIP-10
// marked tags via engine.publishReply; quote mode is still a plain note
// (quote UI is a later pass).

const MAX_PREVIEW_LENGTH = 800;

type Props = NativeStackScreenProps<RootStackParamList, "Composer">;

export function ComposerScreen({ navigation, route }: Props) {
  const engine = useEngine();
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const isLoggedIn = useAppSelector((s) => s.identity.status === "loggedIn");

  const mode = route.params?.mode ?? "note";
  const targetEventId = route.params?.targetEventId;
  const isReply = mode === "reply" && !!targetEventId;

  // Reply target: usually already in the feed buckets; cold deep links fetch.
  const cachedTarget = useAppSelector((s) =>
    isReply && targetEventId ? selectFeedEvent(s, targetEventId) : undefined,
  );
  const [fetchedTarget, setFetchedTarget] = useState<NostrEvent | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const target = cachedTarget ?? fetchedTarget ?? undefined;

  const targetProfile = useAppSelector((s) =>
    target ? s.profiles.byPubkey[target.pubkey] : undefined,
  );
  const targetName = target ? profileDisplayName(targetProfile, target.pubkey) : "";

  useEffect(() => {
    if (!isReply || !targetEventId || cachedTarget) return;
    let cancelled = false;
    engine
      .fetchEvents([{ ids: [targetEventId] }])
      .then((events) => {
        if (cancelled) return;
        if (events.length > 0) setFetchedTarget(events[0]);
        else setTargetMissing(true);
      })
      .catch(() => !cancelled && setTargetMissing(true));
    return () => {
      cancelled = true;
    };
  }, [engine, isReply, targetEventId, cachedTarget]);

  useEffect(() => {
    if (target) engine.requestProfiles([target.pubkey]);
  }, [engine, target]);

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
      let confirmed: boolean;
      if (isReply && target) {
        // When the target is itself a reply, thread under ITS root.
        const ref = parseThreadRef(target);
        confirmed = await engine.publishReply(text, {
          eventId: target.id,
          pubkey: target.pubkey,
          rootId: ref.rootId ?? undefined,
        });
      } else {
        confirmed = await engine.publishNote(text);
      }
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
  const postDisabled = !text.trim() || remaining < 0 || (isReply && !target);

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
          {isReply ? "Reply" : "New note"}
        </Type>
        <Button size="sm" disabled={postDisabled} loading={posting} onPress={post}>
          {isReply ? "Reply" : "Post"}
        </Button>
      </View>

      {isReply ? (
        <View
          className="px-5 pb-3 pt-1"
          style={{
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: tokens.borderLight,
          }}
        >
          {target ? (
            <>
              <Type role="meta" className="lowercase text-muted">
                replying to {targetName}
              </Type>
              <Type role="caption" className="mt-1 text-muted" numberOfLines={2}>
                {target.content}
              </Type>
            </>
          ) : targetMissing ? (
            <Type role="caption" className="text-destructive">
              Couldn't load the note you're replying to.
            </Type>
          ) : (
            <Type role="meta" className="lowercase text-faint">
              loading note…
            </Type>
          )}
        </View>
      ) : null}

      <TextInput
        className="flex-1 px-5 py-3 text-base leading-6 text-heading"
        multiline
        autoFocus
        placeholder={isReply ? `Reply to ${targetName || "this note"}…` : "What's happening on the wire?"}
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
