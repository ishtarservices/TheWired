import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useStore } from "react-redux";
import { Ban, Copy, Flag, Link2, Repeat2, Share2, Zap } from "lucide-react-native";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { ShareNoteSheet } from "@/components/notes/ShareNoteSheet";
import type { NoteFooterHandlers } from "@/components/notes/NoteCardFooter";
import { ActionsSheet, type ActionsSheetRef } from "@/components/ui/ActionsSheet";
import { ZapSheet, type ZapTarget } from "@/components/zaps/ZapSheet";
import { haptics } from "@/lib/haptics";
import { useEngine } from "@/lib/nostr/EngineContext";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { blockUser, reportEvent } from "@/store/moderation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { selectMyReaction, selectMyRepost } from "@/store/slices/engagementSlice";
import type { RootState } from "@/store";

// Note interactions, two surfaces from one hook (one instance per screen):
// the visible footer row (reply · repost · like · zap · share) and the
// long-press sheet (share/copy/report/block — App Store 1.2 moderation
// surface). Guests browse; actions gate in place (requireIdentity → Login).
//
//   const noteActions = useNoteActions();
//   <NoteCard footer={noteActions.footer} onLongPress={noteActions.open} />
//   {noteActions.sheet}

export interface NoteActions {
  open: (event: NostrEvent) => void;
  /** Stable handler object for NoteCard's footer action row. */
  footer: NoteFooterHandlers;
  sheet: ReactNode;
}

export function useNoteActions(): NoteActions {
  const dispatch = useAppDispatch();
  const navigation = useNavigation();
  const engine = useEngine();
  const store = useStore<RootState>();
  const sheetRef = useRef<ActionsSheetRef>(null);
  const repostSheetRef = useRef<ActionsSheetRef>(null);
  const [event, setEvent] = useState<NostrEvent | null>(null);
  const [zapTarget, setZapTarget] = useState<ZapTarget | null>(null);
  const [shareTarget, setShareTarget] = useState<NostrEvent | null>(null);
  const [repostTarget, setRepostTarget] = useState<NostrEvent | null>(null);

  const profile = useAppSelector((s) =>
    event ? s.profiles.byPubkey[event.pubkey] : undefined,
  );
  const reported = useAppSelector((s) =>
    event ? !!s.moderation.reportedEventIds[event.id] : false,
  );

  const open = useCallback((target: NostrEvent) => {
    setEvent(target);
    haptics.tap();
    requestAnimationFrame(() => sheetRef.current?.present());
  }, []);

  // Footer handlers — one stable object so memo'd cards never re-render from
  // handler identity churn. Imperative state reads go through the store.
  const footer = useMemo<NoteFooterHandlers>(() => {
    const requireIdentity = (verb: string): boolean => {
      if (store.getState().identity.status === "loggedIn") return true;
      haptics.warning();
      Alert.alert(
        `Sign in to ${verb}`,
        "Actions are signed by your key — browsing stays open without one.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Sign in", onPress: () => navigation.navigate("Login") },
        ],
      );
      return false;
    };

    return {
      reply(target) {
        haptics.tap();
        // ComposerScreen owns the sign-in gate for replies.
        navigation.navigate("Composer", { mode: "reply", targetEventId: target.id });
      },
      repost(target) {
        if (!requireIdentity("repost")) return;
        const state = store.getState();
        if (selectMyRepost(state, target.id, state.identity.pubkey)) return; // one-way in v1
        haptics.tap();
        setRepostTarget(target);
        requestAnimationFrame(() => repostSheetRef.current?.present());
      },
      like(target) {
        if (!requireIdentity("like notes")) return;
        const state = store.getState();
        if (selectMyReaction(state, target.id, state.identity.pubkey) !== undefined) return;
        haptics.tap();
        engine.publishReaction(target).catch(() => haptics.error());
      },
      zap(target) {
        haptics.tap();
        // ZapSheet self-handles guest / no-wallet states.
        setZapTarget({ recipientPubkey: target.pubkey, event: target });
      },
      share(target) {
        haptics.tap();
        setShareTarget(target); // copy-link stays guest-usable inside the sheet
      },
    };
  }, [engine, navigation, store]);

  const repostActions = useMemo(() => {
    if (!repostTarget) return [];
    return [
      {
        icon: Repeat2,
        label: "Repost",
        sublabel: "Rebroadcast this note to your relays",
        onPress: () => {
          repostSheetRef.current?.dismiss();
          const target = repostTarget;
          setRepostTarget(null);
          engine
            .publishRepost(target)
            .then(() => haptics.success())
            .catch(() => haptics.error());
        },
      },
    ];
  }, [repostTarget, engine]);

  const actions = useMemo(() => {
    if (!event) return [];
    const name = profileDisplayName(profile, event.pubkey);
    return [
      {
        icon: Zap,
        label: `Tip ${name}`,
        sublabel: "Send sats as a zap — a tip between people",
        onPress: () => {
          sheetRef.current?.dismiss();
          setZapTarget({ recipientPubkey: event.pubkey, event });
        },
      },
      {
        icon: Share2,
        label: "Share note",
        sublabel: "Copy link, send as message, post to a space",
        onPress: () => {
          sheetRef.current?.dismiss();
          setShareTarget(event);
        },
      },
      {
        icon: Copy,
        label: "Copy text",
        onPress: () => {
          Clipboard.setStringAsync(event.content).catch(() => {});
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
      {
        icon: Link2,
        label: "Copy note id",
        onPress: () => {
          Clipboard.setStringAsync(nip19.neventEncode({ id: event.id })).catch(() => {});
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
      {
        icon: Flag,
        label: reported ? "Reported" : "Report note",
        sublabel: reported ? "You reported this note" : undefined,
        disabled: reported,
        onPress: () => {
          dispatch(reportEvent(event.id));
          haptics.success();
          sheetRef.current?.dismiss();
        },
      },
      {
        icon: Ban,
        label: `Block ${name}`,
        sublabel: "Hides their notes on this device",
        destructive: true,
        onPress: () => {
          sheetRef.current?.dismiss();
          Alert.alert(
            `Block ${name}?`,
            "Their notes disappear from your feeds on this device. You can unblock from their profile.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Block",
                style: "destructive",
                onPress: () => {
                  dispatch(blockUser(event.pubkey));
                  haptics.warning();
                },
              },
            ],
          );
        },
      },
    ];
  }, [event, profile, reported, dispatch]);

  const title = event
    ? `note by ${profileDisplayName(profile, event.pubkey)}`
    : undefined;

  return {
    open,
    footer,
    sheet: (
      <>
        <ActionsSheet ref={sheetRef} title={title} actions={actions} />
        <ActionsSheet ref={repostSheetRef} title="repost" actions={repostActions} />
        <ZapSheet target={zapTarget} onClose={() => setZapTarget(null)} />
        <ShareNoteSheet target={shareTarget} onClose={() => setShareTarget(null)} />
      </>
    ),
  };
}
