import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/store";
import { EVENT_KINDS } from "@/types/nostr";
import {
  selectSpaceNotes,
  selectSpaceMediaEvents,
  selectSpaceArticles,
  isRootNote,
  stableArray,
} from "../spaces/spaceSelectors";
import {
  selectHiddenPubkeySet,
  selectShowReplies,
  selectShowReposts,
} from "@/store/slices/feedPrefsSlice";
import { isEventVisibleInFeed } from "./feedVisibility";

/**
 * Feed-only selectors: compose DOWNSTREAM of the stableArray-stabilized space
 * selectors so the mute/word filtering only runs when the feed contents, prefs,
 * or mute lists actually change — never on unrelated entity-map ticks.
 * Filtering happens here (not in the event pipeline) so unmute/unhide is
 * instantly reactive: events stay indexed, only display is gated.
 */

const selectMuteList = (state: RootState) => state.identity.muteList;

/** Memoized Set of NIP-51 muted pubkeys. */
export const selectMutedPubkeySet = createSelector(
  [selectMuteList],
  (list) =>
    new Set(list.filter((m) => m.type === "pubkey").map((m) => m.value)),
);

/** Memoized lowercased NIP-51 muted words. */
export const selectMutedWordList = createSelector(
  [selectMuteList],
  (list) =>
    list.filter((m) => m.type === "word").map((m) => m.value.toLowerCase()),
);

/**
 * Feed notes channel: root notes always; replies only when showReplies;
 * reposts (kind:6) only when showReposts. Everything passes the mute/hidden/
 * word visibility gate. (For kind:6 the gate applies to the reposter — the
 * original author is re-checked at render once the reposted event resolves.)
 */
export const selectFriendsFeedNotes = createSelector(
  [
    selectSpaceNotes,
    selectShowReplies,
    selectShowReposts,
    selectMutedPubkeySet,
    selectHiddenPubkeySet,
    selectMutedWordList,
  ],
  (notes, showReplies, showReposts, muted, hidden, words) =>
    notes.filter((e) => {
      if (e.kind === EVENT_KINDS.REPOST) {
        if (!showReposts) return false;
      } else if (e.kind === EVENT_KINDS.SHORT_TEXT) {
        if (!showReplies && !isRootNote(e)) return false;
      } else if (e.kind !== EVENT_KINDS.POLL) {
        return false;
      }
      return isEventVisibleInFeed(e, muted, hidden, words);
    }),
  stableArray,
);

/** IDs for the engagement subscription — for reposts, the original note's id. */
export const selectFriendsFeedNoteIds = createSelector(
  [selectFriendsFeedNotes],
  (notes) =>
    notes.map((e) =>
      e.kind === EVENT_KINDS.REPOST
        ? e.tags.find((t) => t[0] === "e")?.[1] ?? e.id
        : e.id,
    ),
  stableArray,
);

/** Feed media channel with mute/hidden/word filtering (unsorted — caller sorts). */
export const selectFriendsFeedMediaEvents = createSelector(
  [
    selectSpaceMediaEvents,
    selectMutedPubkeySet,
    selectHiddenPubkeySet,
    selectMutedWordList,
  ],
  (events, muted, hidden, words) =>
    events.filter((e) => isEventVisibleInFeed(e, muted, hidden, words)),
  stableArray,
);

/** Feed articles channel with mute/hidden/word filtering. */
export const selectFriendsFeedArticles = createSelector(
  [
    selectSpaceArticles,
    selectMutedPubkeySet,
    selectHiddenPubkeySet,
    selectMutedWordList,
  ],
  (events, muted, hidden, words) =>
    events.filter((e) => isEventVisibleInFeed(e, muted, hidden, words)),
  stableArray,
);
