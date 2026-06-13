import type { NostrEvent } from "../../types/nostr";
import { EVENT_KINDS } from "../../types/nostr";

/** Reference to a music track attached to a poll option via our supplemental
 *  ["track", optionId, "31683:pubkey:dTag"] tag (additive to NIP-88 — other
 *  clients just render the option's plain-text label). */
export interface PollTrackRef {
  kind: number;
  pubkey: string;
  identifier: string;
}

export interface PollOption {
  id: string;
  label: string;
  trackRef?: PollTrackRef;
}

export interface ParsedPoll {
  id: string;
  pubkey: string;
  createdAt: number;
  /** event.content per NIP-88 */
  question: string;
  options: PollOption[];
  pollType: "singlechoice" | "multiplechoice";
  /** Unix seconds; undefined = no end time (also for malformed values) */
  endsAt?: number;
  /** Relays the poll author expects votes on (["relay", url] tags) */
  relays: string[];
  /** NIP-29 space scoping (our additive h/channel tags) */
  spaceId?: string;
  channelId?: string;
}

export interface ParsedVote {
  pollId: string;
  voter: string;
  optionIds: string[];
  createdAt: number;
  eventId: string;
}

/** Parse a ["track", optionId, "31683:pubkey:dTag"] address into a ref.
 *  Only music-track kinds are honored; anything else is ignored. */
function parseTrackAddress(addr: string): PollTrackRef | undefined {
  const parts = addr.split(":");
  if (parts.length < 3) return undefined;
  const kind = parseInt(parts[0], 10);
  if (kind !== EVENT_KINDS.MUSIC_TRACK) return undefined;
  const pubkey = parts[1];
  const identifier = parts.slice(2).join(":");
  if (!/^[0-9a-f]{64}$/.test(pubkey) || !identifier) return undefined;
  return { kind, pubkey, identifier };
}

export function parsePollEvent(event: NostrEvent): ParsedPoll {
  const options: PollOption[] = [];
  const seenIds = new Set<string>();
  const trackByOption = new Map<string, PollTrackRef>();
  const relays: string[] = [];
  let pollType: ParsedPoll["pollType"] = "singlechoice";
  let endsAt: number | undefined;
  let spaceId: string | undefined;
  let channelId: string | undefined;

  for (const tag of event.tags) {
    switch (tag[0]) {
      case "option": {
        // Duplicate option ids: first occurrence wins
        if (tag[1] && !seenIds.has(tag[1])) {
          seenIds.add(tag[1]);
          options.push({ id: tag[1], label: tag[2] ?? "" });
        }
        break;
      }
      case "track": {
        if (tag[1] && tag[2]) {
          const ref = parseTrackAddress(tag[2]);
          if (ref) trackByOption.set(tag[1], ref);
        }
        break;
      }
      case "relay": {
        if (tag[1] && /^wss?:\/\//.test(tag[1])) relays.push(tag[1]);
        break;
      }
      case "polltype": {
        if (tag[1] === "multiplechoice") pollType = "multiplechoice";
        break;
      }
      case "endsAt": {
        const ts = parseInt(tag[1] ?? "", 10);
        if (Number.isFinite(ts) && ts > 0) endsAt = ts;
        break;
      }
      case "h": {
        if (tag[1]) spaceId = spaceId ?? tag[1];
        break;
      }
      case "channel": {
        if (tag[1]) channelId = channelId ?? tag[1];
        break;
      }
    }
  }

  for (const option of options) {
    const ref = trackByOption.get(option.id);
    if (ref) option.trackRef = ref;
  }

  return {
    id: event.id,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    question: event.content,
    options,
    pollType,
    endsAt,
    relays,
    spaceId,
    channelId,
  };
}

/** Parse a kind:1018 vote. Returns null when structurally unusable
 *  (no poll reference or no response tags). */
export function parseVoteEvent(event: NostrEvent): ParsedVote | null {
  const pollId = event.tags.find((t) => t[0] === "e")?.[1];
  if (!pollId) return null;

  const optionIds: string[] = [];
  const seen = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] === "response" && tag[1] && !seen.has(tag[1])) {
      seen.add(tag[1]);
      optionIds.push(tag[1]);
    }
  }
  if (optionIds.length === 0) return null;

  return {
    pollId,
    voter: event.pubkey,
    optionIds,
    createdAt: event.created_at,
    eventId: event.id,
  };
}
