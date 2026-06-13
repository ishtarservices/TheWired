import type { NostrEvent } from "@/types/nostr";

/**
 * Case-insensitive substring match of NIP-51 muted words against content.
 * Deliberately simple semantics: no word-boundary/regex matching, and only
 * the content string is scanned (not tags or titles) — cheap and predictable.
 * `lowercasedWords` must already be lowercased (see selectMutedWordList).
 */
export function matchesMutedWord(
  content: string,
  lowercasedWords: string[],
): boolean {
  if (lowercasedWords.length === 0) return false;
  const haystack = content.toLowerCase();
  return lowercasedWords.some((w) => haystack.includes(w));
}

/**
 * Visibility gate for the Feed: the author is neither muted (NIP-51) nor
 * locally hidden, and the content passes the muted-word filter.
 */
export function isEventVisibleInFeed(
  event: NostrEvent,
  mutedPubkeys: ReadonlySet<string>,
  hiddenPubkeys: ReadonlySet<string>,
  mutedWords: string[],
): boolean {
  if (mutedPubkeys.has(event.pubkey)) return false;
  if (hiddenPubkeys.has(event.pubkey)) return false;
  return !matchesMutedWord(event.content, mutedWords);
}
