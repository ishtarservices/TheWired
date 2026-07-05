import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ban, Copy, Flag, Link2 } from "lucide-react-native";
import { nip19 } from "nostr-tools";
import type { NostrEvent } from "@thewired/shared-types";

import { ActionsSheet, type ActionsSheetRef } from "@/components/ui/ActionsSheet";
import { haptics } from "@/lib/haptics";
import { profileDisplayName } from "@/lib/nostr/profiles";
import { blockUser, reportEvent } from "@/store/moderation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

// Long-press actions for any note (App Store 1.2 moderation surface):
// copy text / copy id, report (queued locally for now), block author
// (immediately hides their content everywhere on this device). One sheet
// instance per screen:
//
//   const noteActions = useNoteActions();
//   <NoteCard onLongPress={() => noteActions.open(event)} />
//   {noteActions.sheet}

export interface NoteActions {
  open: (event: NostrEvent) => void;
  sheet: ReactNode;
}

export function useNoteActions(): NoteActions {
  const dispatch = useAppDispatch();
  const sheetRef = useRef<ActionsSheetRef>(null);
  const [event, setEvent] = useState<NostrEvent | null>(null);

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

  const actions = useMemo(() => {
    if (!event) return [];
    const name = profileDisplayName(profile, event.pubkey);
    return [
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
    sheet: <ActionsSheet ref={sheetRef} title={title} actions={actions} />,
  };
}
