/**
 * READ tools — auto-run (no gate), but every result is wrapped as UNTRUSTED data
 * since it can contain attacker-controlled note/DM/profile text. They reuse the
 * same context builders as "Ask AI" and drop muted authors. (master plan §8.)
 */
import { store } from "@/store";
import type { NostrEvent } from "@/types/nostr";
import {
  buildProfileContext,
  buildThreadContext,
  buildSpaceContext,
  frameUntrustedBlock,
  frameUntrustedContext,
  displayName,
} from "../context/aiContext";
import type { ToolDef } from "./types";
import { toHexPubkey, asString } from "./validate";

function mutedSet(): Set<string> {
  return new Set(
    store
      .getState()
      .identity.muteList.filter((m) => m.type === "pubkey")
      .map((m) => m.value),
  );
}

const get_profile: ToolDef = {
  name: "get_profile",
  description:
    "Get a Nostr user's profile metadata and a sample of their recent notes. Accepts an npub or 64-char hex pubkey.",
  parameters: {
    type: "object",
    properties: { pubkey: { type: "string", description: "npub or hex pubkey" } },
    required: ["pubkey"],
  },
  access: "read",
  run(args) {
    const hex = toHexPubkey(args.pubkey);
    if (!hex) return { output: "Error: invalid pubkey (expected npub or 64-char hex)." };
    return { output: frameUntrustedContext(buildProfileContext(hex)) };
  },
};

const read_thread: ToolDef = {
  name: "read_thread",
  description:
    "Read a note and its loaded replies by the note's event id (64-char hex). Returns the root note plus replies as data.",
  parameters: {
    type: "object",
    properties: { eventId: { type: "string", description: "note event id (hex)" } },
    required: ["eventId"],
  },
  access: "read",
  run(args) {
    const id = asString(args.eventId).trim();
    const ctx = buildThreadContext(id);
    if (!ctx) return { output: "Error: that note isn't loaded in the app." };
    return { output: frameUntrustedContext(ctx) };
  },
};

const read_space_feed: ToolDef = {
  name: "read_space_feed",
  description: "Read recent activity in one of the user's spaces by space id.",
  parameters: {
    type: "object",
    properties: { spaceId: { type: "string" } },
    required: ["spaceId"],
  },
  access: "read",
  run(args) {
    const ctx = buildSpaceContext(asString(args.spaceId).trim());
    if (!ctx) return { output: "Error: that space isn't loaded." };
    return { output: frameUntrustedContext(ctx) };
  },
};

const list_my_spaces: ToolDef = {
  name: "list_my_spaces",
  description: "List the spaces the current user is a member of (name + id).",
  parameters: { type: "object", properties: {} },
  access: "read",
  run() {
    const spaces = store.getState().spaces.list;
    if (spaces.length === 0) return { output: "The user is not in any spaces." };
    // Space names are attacker-authorable (NIP-29 kind:39000) — clamp + frame as
    // untrusted like every other read tool (don't leak them as trusted text).
    const lines = spaces.map(
      (s) => `- ${s.name.replace(/\s+/g, " ").slice(0, 80)} (id: ${s.id}, ${s.memberPubkeys.length} members)`,
    );
    return { output: frameUntrustedBlock("YOUR SPACES", lines.join("\n")) };
  },
};

const search_notes: ToolDef = {
  name: "search_notes",
  description:
    "Search notes currently loaded in the app by substring. Returns matching notes (muted authors excluded) as data.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number", description: "max results (1-20)" },
    },
    required: ["query"],
  },
  access: "read",
  run(args) {
    const query = asString(args.query).trim().toLowerCase();
    if (query.length < 2) return { output: "Error: query too short." };
    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);
    const muted = mutedSet();
    const state = store.getState();
    const matches: NostrEvent[] = [];
    for (const id of Object.keys(state.events.entities)) {
      const e = state.events.entities[id];
      if (!e || (e.kind !== 1 && e.kind !== 9)) continue;
      if (muted.has(e.pubkey)) continue;
      if (e.content.toLowerCase().includes(query)) matches.push(e);
      if (matches.length >= limit * 3) break;
    }
    matches.sort((a, b) => b.created_at - a.created_at);
    const top = matches.slice(0, limit);
    if (top.length === 0) return { output: `No loaded notes match "${query}".` };
    const lines = top.map(
      (e) => `${displayName(e.pubkey)} (${e.id.slice(0, 8)}): ${e.content.replace(/\s+/g, " ").slice(0, 280)}`,
    );
    return { output: frameUntrustedBlock("SEARCH RESULTS", lines.join("\n")) };
  },
};

export const READ_TOOLS: ToolDef[] = [
  get_profile,
  read_thread,
  read_space_feed,
  list_my_spaces,
  search_notes,
];
