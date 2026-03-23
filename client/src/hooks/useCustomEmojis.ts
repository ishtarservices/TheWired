import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import type { CustomEmoji } from "@/types/emoji";

interface EmojiMartCustomCategory {
  id: string;
  name: string;
  emojis: Array<{
    id: string;
    name: string;
    keywords: string[];
    skins: Array<{ src: string }>;
  }>;
}

/** Get all available custom emojis for the current context (user + space) */
export function useCustomEmojis(spaceId?: string | null) {
  const userEmojis = useAppSelector((s) => s.emoji.userEmojis);
  const emojiSets = useAppSelector((s) => s.emoji.emojiSets);
  const spaceEmojiSetIds = useAppSelector((s) =>
    spaceId ? s.emoji.spaceEmojiSets[spaceId] : undefined,
  );

  return useMemo(() => {
    const allEmojis: CustomEmoji[] = [...userEmojis];

    // Add space-scoped emojis
    if (spaceEmojiSetIds) {
      for (const setId of spaceEmojiSetIds) {
        const set = emojiSets[setId];
        if (set) {
          allEmojis.push(...set.emojis);
        }
      }
    }

    return allEmojis;
  }, [userEmojis, emojiSets, spaceEmojiSetIds]);
}

/** Transform custom emojis into emoji-mart custom categories format */
export function useEmojiMartCustomCategories(spaceId?: string | null): EmojiMartCustomCategory[] {
  const userEmojis = useAppSelector((s) => s.emoji.userEmojis);
  const emojiSets = useAppSelector((s) => s.emoji.emojiSets);
  const spaceEmojiSetIds = useAppSelector((s) =>
    spaceId ? s.emoji.spaceEmojiSets[spaceId] : undefined,
  );

  return useMemo(() => {
    const categories: EmojiMartCustomCategory[] = [];

    // User's personal emojis
    if (userEmojis.length > 0) {
      categories.push({
        id: "my-emojis",
        name: "My Emojis",
        emojis: userEmojis.map((e) => ({
          id: e.shortcode,
          name: e.shortcode,
          keywords: [e.shortcode],
          skins: [{ src: e.url }],
        })),
      });
    }

    // Space-scoped emoji sets
    if (spaceEmojiSetIds) {
      for (const setId of spaceEmojiSetIds) {
        const set = emojiSets[setId];
        if (set && set.emojis.length > 0) {
          categories.push({
            id: set.addressableId,
            name: set.title || "Space Emojis",
            emojis: set.emojis.map((e) => ({
              id: e.shortcode,
              name: e.shortcode,
              keywords: [e.shortcode],
              skins: [{ src: e.url }],
            })),
          });
        }
      }
    }

    return categories;
  }, [userEmojis, emojiSets, spaceEmojiSetIds]);
}
