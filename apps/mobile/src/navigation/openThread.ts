// The single "open a conversation" primitive — every surface that taps into
// a thread (feed cards, reply rows, embed cards, inline refs, parent lines)
// routes through here so navigation semantics stay uniform. RN7's `navigate`
// no longer pops back to an existing screen, so mixed navigate/push call
// sites each stacked a fresh NoteThread; this centralizes the policy:
// no-op when the target is already focused, POP back to an existing
// instance across a pure thread walk (back-gesture semantics — scroll and
// expansion state survive because native-stack keeps screens mounted),
// PUSH otherwise.

import { useCallback } from "react";
import {
  StackActions,
  useNavigation,
  type NavigationAction,
} from "@react-navigation/native";

export interface ThreadTarget {
  noteId: string;
  /** Conversation root when the caller has the tapped event in hand
   *  (parseThreadRef) — lets the screen render from cache with no fetch. */
  rootId?: string;
}

/** Structural subset of every navigation prop shape (tab-nested or root,
 *  hook-returned or screen-prop) — RN7's own prop types disagree on whether
 *  getState() can return undefined, so a nominal type can't cover them all. */
interface AnyNavigation {
  getParent(): AnyNavigation | undefined;
  getState(): { routes: Array<{ name: string; params?: object }> } | undefined;
  dispatch(action: NavigationAction): void;
}

export function openThread(navigation: AnyNavigation, target: ThreadTarget): void {
  // Tab screens see their tab stack's state — walk up to the root stack,
  // where NoteThread lives.
  let nav: AnyNavigation = navigation;
  for (let parent = nav.getParent(); parent; parent = nav.getParent()) nav = parent;

  const routes = nav.getState()?.routes ?? [];
  // Most recent NoteThread instance anchored on this note.
  let matchIndex = -1;
  for (let i = routes.length - 1; i >= 0; i--) {
    const route = routes[i];
    if (
      route.name === "NoteThread" &&
      (route.params as ThreadTarget | undefined)?.noteId === target.noteId
    ) {
      matchIndex = i;
      break;
    }
  }
  if (matchIndex >= 0 && matchIndex === routes.length - 1) return; // already looking at it

  // Pop back only across a contiguous NoteThread run (a pure thread walk,
  // e.g. root → reply → root). A detour above the match (Profile, Article…)
  // is back-trail the user built — popping would silently discard it, so
  // push a fresh instance instead. RN7 pitfall: popTo REPLACES the current
  // screen when nothing matches, so it must never be the fallback.
  const contiguousThreadRun =
    matchIndex >= 0 &&
    routes.slice(matchIndex + 1).every((route) => route.name === "NoteThread");
  if (contiguousThreadRun) {
    // getId (noteId) targets the right instance; merge keeps its params.
    nav.dispatch(StackActions.popTo("NoteThread", target, { merge: true }));
  } else {
    nav.dispatch(StackActions.push("NoteThread", target));
  }
}

/** Stable callback wrapper — safe to hand to memo'd cards. */
export function useOpenThread(): (target: ThreadTarget) => void {
  const navigation = useNavigation();
  return useCallback((target: ThreadTarget) => openThread(navigation, target), [navigation]);
}
