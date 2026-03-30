import { useState, useEffect, useCallback } from "react";
import { nip19 } from "nostr-tools";
import { useAppSelector } from "@/store/hooks";
import { profileCache } from "@/lib/nostr/profileCache";
import type { NostrEvent } from "@/types/nostr";
import type { DMMessage } from "@/store/slices/dmSlice";
import type { SpaceChannel } from "@/types/space";

// ── Types ──

export interface ParsedFilters {
  text: string;
  from?: string;
  fromRaw?: string;
  channel?: string;
  channelRaw?: string;
  has?: string;
  mentions?: string;
  mentionsRaw?: string;
  before?: number;
  after?: number;
}

export interface MessageSearchResult {
  id: string;
  content: string;
  authorPubkey: string;
  timestamp: number;
  channelId?: string;
  channelLabel?: string;
  eventId?: string;
  wrapId?: string;
  partnerPubkey?: string;
}

export type SearchMode = "space" | "dm";

interface UseMessageSearchOpts {
  mode: SearchMode;
  spaceId?: string | null;
  channels?: SpaceChannel[];
  partnerPubkey?: string | null;
}

const HISTORY_KEY = "wired:search-history";
const MAX_HISTORY = 10;
const RESULTS_LIMIT = 50;

// ── Query Parsing ──

const FILTER_PREFIXES = ["from", "in", "has", "mentions", "before", "after"] as const;

export function parseSearchQuery(
  raw: string,
  channels?: SpaceChannel[],
): ParsedFilters {
  const filters: ParsedFilters = { text: "" };
  const textParts: string[] = [];

  // Tokenize: respect quoted values like from:"some name"
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === " " && !inQuote) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx === -1) {
      textParts.push(token);
      continue;
    }

    const prefix = token.slice(0, colonIdx).toLowerCase();
    const value = token.slice(colonIdx + 1);

    if (!value || !FILTER_PREFIXES.includes(prefix as (typeof FILTER_PREFIXES)[number])) {
      textParts.push(token);
      continue;
    }

    switch (prefix) {
      case "from": {
        filters.fromRaw = value;
        filters.from = resolveUserToPubkey(value);
        break;
      }
      case "in": {
        filters.channelRaw = value;
        if (channels) {
          const norm = value.replace(/^#/, "").toLowerCase();
          const match = channels.find(
            (c) =>
              c.id === value ||
              c.label.replace(/^#/, "").toLowerCase() === norm ||
              c.type.toLowerCase() === norm,
          );
          if (match) filters.channel = match.id;
        }
        break;
      }
      case "has":
        filters.has = value.toLowerCase();
        break;
      case "mentions": {
        filters.mentionsRaw = value;
        filters.mentions = resolveUserToPubkey(value);
        break;
      }
      case "before":
        filters.before = parseDateInput(value);
        break;
      case "after":
        filters.after = parseDateInput(value);
        break;
    }
  }

  filters.text = textParts.join(" ").trim();
  return filters;
}

/** Detect which filter prefix is currently being typed (cursor at end) */
export function detectActivePrefix(query: string): string | null {
  const trimmed = query.trimEnd();
  for (const prefix of FILTER_PREFIXES) {
    if (trimmed.endsWith(`${prefix}:`)) return prefix;
  }
  return null;
}

// ── Resolution Helpers ──

function resolveUserToPubkey(input: string): string | undefined {
  if (!input) return undefined;
  if (input.startsWith("npub1")) {
    try {
      const decoded = nip19.decode(input);
      if (decoded.type === "npub") return decoded.data;
    } catch {
      return undefined;
    }
  }
  if (/^[0-9a-f]{64}$/i.test(input)) return input.toLowerCase();
  const results = profileCache.searchCached(input, 1);
  return results.length > 0 ? results[0].pubkey : undefined;
}

function parseDateInput(input: string): number | undefined {
  const lower = input.toLowerCase();
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );

  if (lower === "today")
    return Math.floor(startOfToday.getTime() / 1000);
  if (lower === "yesterday")
    return Math.floor((startOfToday.getTime() - 86400000) / 1000);

  const parsed = Date.parse(input);
  if (!isNaN(parsed)) return Math.floor(parsed / 1000);
  return undefined;
}

function contentHasType(event: NostrEvent, type: string): boolean {
  const c = event.content;
  switch (type) {
    case "link":
      return /https?:\/\/\S+/.test(c);
    case "image":
      return (
        /https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)/i.test(c) ||
        event.tags.some((t) => t[0] === "image" || t[0] === "thumb")
      );
    case "video":
      return (
        /https?:\/\/\S+\.(mp4|webm|mov|avi|m3u8)/i.test(c) ||
        event.tags.some((t) => t[0] === "video" || t[0] === "stream")
      );
    case "file":
      return (
        event.tags.some((t) => t[0] === "url" || t[0] === "file") ||
        /https?:\/\/\S+\.(pdf|zip|tar|gz|rar|doc|xlsx?|csv)/i.test(c)
      );
    case "embed":
      return /https?:\/\/(www\.)?(youtube\.com|youtu\.be|twitter\.com|x\.com|spotify\.com|soundcloud\.com|open\.spotify\.com)/i.test(
        c,
      );
    default:
      return false;
  }
}

function dmContentHasType(content: string, type: string): boolean {
  switch (type) {
    case "link":
      return /https?:\/\/\S+/.test(content);
    case "image":
      return /https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|avif)/i.test(content);
    case "video":
      return /https?:\/\/\S+\.(mp4|webm|mov|avi|m3u8)/i.test(content);
    case "file":
      return /https?:\/\/\S+\.(pdf|zip|tar|gz|rar|doc|xlsx?|csv)/i.test(content);
    case "embed":
      return /https?:\/\/(www\.)?(youtube\.com|youtu\.be|twitter\.com|x\.com|spotify\.com|soundcloud\.com)/i.test(content);
    default:
      return false;
  }
}

// ── Search Functions ──

function searchSpaceMessages(
  filters: ParsedFilters,
  spaceId: string,
  channels: SpaceChannel[],
  chatMessages: Record<string, string[]>,
  spaceFeeds: Record<string, string[]>,
  entities: Record<string, NostrEvent>,
): MessageSearchResult[] {
  const results: MessageSearchResult[] = [];
  const textLower = filters.text.toLowerCase();

  const targetChannels = filters.channel
    ? channels.filter((c) => c.id === filters.channel)
    : channels;

  for (const channel of targetChannels) {
    const contextId = `${spaceId}:${channel.id}`;

    // Chat channels use chatMessages index; others use spaceFeeds
    const eventIds =
      channel.type === "chat"
        ? (chatMessages[contextId] ?? [])
        : (spaceFeeds[`${spaceId}:${channel.type}`] ?? []);

    for (const eventId of eventIds) {
      const event = entities[eventId];
      if (!event) continue;

      if (textLower && !event.content.toLowerCase().includes(textLower))
        continue;
      if (filters.from && event.pubkey !== filters.from) continue;
      if (
        filters.mentions &&
        !event.tags.some(
          (t) => t[0] === "p" && t[1] === filters.mentions,
        )
      )
        continue;
      if (filters.has && !contentHasType(event, filters.has)) continue;
      if (filters.before && event.created_at >= filters.before) continue;
      if (filters.after && event.created_at <= filters.after) continue;

      results.push({
        id: event.id,
        content: event.content,
        authorPubkey: event.pubkey,
        timestamp: event.created_at,
        channelId: channel.id,
        channelLabel: (channel.label || channel.type).replace(/^#/, ""),
        eventId: event.id,
      });
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results;
}

function searchDMMessages(
  filters: ParsedFilters,
  dmMessages: Record<string, DMMessage[]>,
  partnerPubkey: string | null,
): MessageSearchResult[] {
  const results: MessageSearchResult[] = [];
  const textLower = filters.text.toLowerCase();

  const keys = partnerPubkey ? [partnerPubkey] : Object.keys(dmMessages);

  for (const pk of keys) {
    const messages = dmMessages[pk] ?? [];

    for (const msg of messages) {
      if (msg.isDeleted) continue;

      const content = msg.editedContent ?? msg.content;

      if (textLower && !content.toLowerCase().includes(textLower)) continue;
      if (filters.from && msg.senderPubkey !== filters.from) continue;
      if (filters.has && !dmContentHasType(content, filters.has)) continue;
      if (filters.before && msg.createdAt >= filters.before) continue;
      if (filters.after && msg.createdAt <= filters.after) continue;

      results.push({
        id: msg.id,
        content,
        authorPubkey: msg.senderPubkey,
        timestamp: msg.createdAt,
        wrapId: msg.wrapId,
        partnerPubkey: pk,
      });
    }
  }

  results.sort((a, b) => b.timestamp - a.timestamp);
  return results;
}

// ── Main Hook ──

export function useMessageSearch(opts: UseMessageSearchOpts) {
  const { mode, spaceId, channels, partnerPubkey } = opts;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const chatMessages = useAppSelector((s) => s.events.chatMessages);
  const entities = useAppSelector((s) => s.events.entities);
  const spaceFeeds = useAppSelector((s) => s.events.spaceFeeds);
  const dmMsgs = useAppSelector((s) => s.dm.messages);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setResultCount(0);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const timer = setTimeout(() => {
      const parsed = parseSearchQuery(trimmed, channels);

      // Must have at least one meaningful filter (channelRaw counts even if
      // it didn't resolve to a channel id — it still indicates intent to search)
      const hasFilter =
        parsed.text ||
        parsed.from ||
        parsed.channel ||
        parsed.channelRaw ||
        parsed.has ||
        parsed.mentions ||
        parsed.before ||
        parsed.after;

      if (!hasFilter) {
        setResults([]);
        setResultCount(0);
        setIsSearching(false);
        return;
      }

      let found: MessageSearchResult[];

      if (mode === "space" && spaceId) {
        found = searchSpaceMessages(
          parsed,
          spaceId,
          channels ?? [],
          chatMessages,
          spaceFeeds,
          entities,
        );
      } else if (mode === "dm") {
        found = searchDMMessages(parsed, dmMsgs, partnerPubkey ?? null);
      } else {
        found = [];
      }

      setResultCount(found.length);
      setResults(found.slice(0, RESULTS_LIMIT));
      setIsSearching(false);
    }, 200);

    return () => clearTimeout(timer);
  }, [query, mode, spaceId, channels, partnerPubkey, chatMessages, entities, spaceFeeds, dmMsgs]);

  // ── History ──

  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    } catch {
      return [];
    }
  });

  const addToHistory = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeFromHistory = useCallback((q: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== q);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  return {
    query,
    setQuery,
    results,
    resultCount,
    isSearching,
    history,
    addToHistory,
    removeFromHistory,
    clearHistory,
  };
}
