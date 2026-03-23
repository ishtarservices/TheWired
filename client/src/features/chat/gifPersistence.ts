import { saveUserState, getUserState } from "@/lib/db/userStateStore";
import type { GifItem } from "@/types/emoji";

const FAVORITES_KEY = "gif_favorites";
const RECENTS_KEY = "gif_recents";

export async function loadGifFavorites(): Promise<GifItem[]> {
  return (await getUserState<GifItem[]>(FAVORITES_KEY)) ?? [];
}

export async function saveGifFavorites(favorites: GifItem[]): Promise<void> {
  await saveUserState(FAVORITES_KEY, favorites);
}

export async function loadGifRecents(): Promise<GifItem[]> {
  return (await getUserState<GifItem[]>(RECENTS_KEY)) ?? [];
}

export async function saveGifRecents(recents: GifItem[]): Promise<void> {
  await saveUserState(RECENTS_KEY, recents);
}
