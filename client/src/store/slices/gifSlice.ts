import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { GifItem } from "@/types/emoji";

const MAX_FAVORITES = 250;
const MAX_RECENTS = 50;

interface GifState {
  favorites: GifItem[];
  recents: GifItem[];
}

const initialState: GifState = {
  favorites: [],
  recents: [],
};

export const gifSlice = createSlice({
  name: "gif",
  initialState,
  reducers: {
    addFavorite(state, action: PayloadAction<GifItem>) {
      // Don't duplicate
      if (state.favorites.some((g) => g.id === action.payload.id)) return;
      state.favorites.unshift(action.payload);
      if (state.favorites.length > MAX_FAVORITES) {
        state.favorites = state.favorites.slice(0, MAX_FAVORITES);
      }
    },
    removeFavorite(state, action: PayloadAction<string>) {
      state.favorites = state.favorites.filter((g) => g.id !== action.payload);
    },
    addRecent(state, action: PayloadAction<GifItem>) {
      // Remove if already present, then add to front
      state.recents = state.recents.filter((g) => g.id !== action.payload.id);
      state.recents.unshift(action.payload);
      if (state.recents.length > MAX_RECENTS) {
        state.recents = state.recents.slice(0, MAX_RECENTS);
      }
    },
    restoreGifState(state, action: PayloadAction<{ favorites?: GifItem[]; recents?: GifItem[] }>) {
      if (action.payload.favorites) state.favorites = action.payload.favorites;
      if (action.payload.recents) state.recents = action.payload.recents;
    },
  },
});

export const { addFavorite, removeFavorite, addRecent, restoreGifState } = gifSlice.actions;
