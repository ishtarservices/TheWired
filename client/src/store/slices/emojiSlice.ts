import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CustomEmoji, EmojiSet } from "@/types/emoji";

interface EmojiState {
  /** User's personal emoji list (from kind:10030) */
  userEmojis: CustomEmoji[];
  /** Emoji sets loaded from relay, keyed by addressableId */
  emojiSets: Record<string, EmojiSet>;
  /** Space-scoped emoji set addressable IDs, keyed by spaceId */
  spaceEmojiSets: Record<string, string[]>;
  /** Fast lookup: shortcode -> CustomEmoji (rebuilt when sets change) */
  shortcodeIndex: Record<string, CustomEmoji>;
}

const initialState: EmojiState = {
  userEmojis: [],
  emojiSets: {},
  spaceEmojiSets: {},
  shortcodeIndex: {},
};

/** Rebuild the shortcode index from all loaded emoji sources */
function buildShortcodeIndex(state: EmojiState): Record<string, CustomEmoji> {
  const index: Record<string, CustomEmoji> = {};
  // User emojis take lowest priority
  for (const e of state.userEmojis) {
    index[e.shortcode] = e;
  }
  // Emoji sets
  for (const set of Object.values(state.emojiSets)) {
    for (const e of set.emojis) {
      index[e.shortcode] = e;
    }
  }
  return index;
}

export const emojiSlice = createSlice({
  name: "emoji",
  initialState,
  reducers: {
    setUserEmojis(state, action: PayloadAction<CustomEmoji[]>) {
      state.userEmojis = action.payload;
      state.shortcodeIndex = buildShortcodeIndex(state);
    },
    addEmojiSet(state, action: PayloadAction<EmojiSet>) {
      const set = action.payload;
      state.emojiSets[set.addressableId] = set;
      state.shortcodeIndex = buildShortcodeIndex(state);
    },
    removeEmojiSet(state, action: PayloadAction<string>) {
      delete state.emojiSets[action.payload];
      state.shortcodeIndex = buildShortcodeIndex(state);
    },
    setSpaceEmojiSets(state, action: PayloadAction<{ spaceId: string; setIds: string[] }>) {
      state.spaceEmojiSets[action.payload.spaceId] = action.payload.setIds;
    },
  },
});

export const { setUserEmojis, addEmojiSet, removeEmojiSet, setSpaceEmojiSets } = emojiSlice.actions;
