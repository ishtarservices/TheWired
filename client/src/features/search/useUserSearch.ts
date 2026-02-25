import { useState, useEffect, useRef, useCallback } from "react";
import { nip19 } from "nostr-tools";
import { profileCache } from "@/lib/nostr/profileCache";
import { relayManager } from "@/lib/nostr/relayManager";
import type { Kind0Profile } from "@/types/profile";

const SEARCH_RELAY = "wss://relay.nostr.band";

export interface UserSearchResult {
  pubkey: string;
  profile: Kind0Profile;
}

/**
 * Hybrid user search: instant local profileCache + debounced NIP-50 relay search.
 * Detects npub/hex input and resolves specific pubkeys instead of text search.
 */
export function useUserSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const subIdRef = useRef<string | null>(null);
  const relayResultsRef = useRef<Map<string, UserSearchResult>>(new Map());

  const cleanup = useCallback(() => {
    if (subIdRef.current) {
      relayManager.closeSubscription(subIdRef.current);
      subIdRef.current = null;
    }
    relayResultsRef.current.clear();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      cleanup();
      return;
    }

    // Check for npub/hex pubkey input
    const directPubkey = parsePubkeyInput(trimmed);
    if (directPubkey) {
      cleanup();
      // Resolve this specific pubkey
      const cached = profileCache.getCached(directPubkey);
      if (cached) {
        setResults([{ pubkey: directPubkey, profile: cached }]);
        setIsSearching(false);
      } else {
        setResults([{ pubkey: directPubkey, profile: {} }]);
        setIsSearching(true);
        const unsub = profileCache.subscribe(directPubkey, (profile) => {
          setResults([{ pubkey: directPubkey, profile }]);
          setIsSearching(false);
        });
        // Auto-cleanup after 5s
        const timeout = setTimeout(() => {
          unsub();
          setIsSearching(false);
        }, 5000);
        return () => {
          unsub();
          clearTimeout(timeout);
        };
      }
      return;
    }

    // Text search: instant local results
    const localResults = profileCache.searchCached(trimmed, 10);
    setResults(localResults);

    // Debounced NIP-50 relay search
    const timer = setTimeout(() => {
      cleanup();
      setIsSearching(true);

      // Ensure relay.nostr.band is connected
      relayManager.connect(SEARCH_RELAY, "read");

      relayManager.waitForConnection(SEARCH_RELAY, 5000).then((connected) => {
        if (!connected) {
          setIsSearching(false);
          return;
        }

        relayResultsRef.current.clear();

        const subId = relayManager.subscribe({
          filters: [{ kinds: [0], search: trimmed, limit: 10 }],
          relayUrls: [SEARCH_RELAY],
          onEvent: (event) => {
            profileCache.handleProfileEvent(event);
            const profile = profileCache.getCached(event.pubkey);
            if (profile) {
              relayResultsRef.current.set(event.pubkey, {
                pubkey: event.pubkey,
                profile,
              });
              // Merge local + relay, deduped by pubkey
              const merged = mergeResults(
                profileCache.searchCached(trimmed, 10),
                relayResultsRef.current,
              );
              setResults(merged);
            }
          },
          onEOSE: () => {
            setIsSearching(false);
            if (subIdRef.current) {
              relayManager.closeSubscription(subIdRef.current);
              subIdRef.current = null;
            }
          },
        });

        subIdRef.current = subId;
      });
    }, 300);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [query, cleanup]);

  return { query, setQuery, results, isSearching };
}

function parsePubkeyInput(input: string): string | null {
  if (input.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      return null;
    }
  }
  if (/^[0-9a-f]{64}$/i.test(input)) {
    return input.toLowerCase();
  }
  return null;
}

function mergeResults(
  local: UserSearchResult[],
  relay: Map<string, UserSearchResult>,
): UserSearchResult[] {
  const seen = new Set<string>();
  const merged: UserSearchResult[] = [];

  for (const r of local) {
    if (!seen.has(r.pubkey)) {
      seen.add(r.pubkey);
      merged.push(r);
    }
  }
  for (const r of relay.values()) {
    if (!seen.has(r.pubkey)) {
      seen.add(r.pubkey);
      merged.push(r);
    }
  }

  return merged;
}
