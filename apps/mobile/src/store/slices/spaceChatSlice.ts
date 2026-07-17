// ─── Space chat backlog cache ─────────────────────────────────────────
// In-memory holder for per-channel kind-9 backlogs so re-entering a channel
// paints instantly instead of re-paying the socket dial + NIP-42 AUTH +
// backlog round trip. Events arrive verified (chatSession verifies before
// onMessage) and hydrate from the space_chat SQLite store through
// store/spaceChat.ts thunks — the dm/feed hydrate-before-network pattern.
// Muted-author filtering happens at render (the reducer can't read the
// moderation slice), matching the ChannelScreen contract.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { NostrEvent } from "@thewired/shared-types";

import { channelKey } from "./spacePreviewsSlice";

/** Per-channel in-memory cap — was ChannelScreen's MAX_MESSAGES. */
export const MAX_CHANNEL_MESSAGES = 200;

interface SpaceChatState {
  /** `${spaceId}/${channelId}` → ascending, id-deduped events (≤ cap). */
  byChannel: Record<string, NostrEvent[]>;
  /** Keys whose SQLite row was read this session — dedups hydrate reads. */
  hydrated: Record<string, true>;
}

const initialState: SpaceChatState = { byChannel: {}, hydrated: {} };

/** Deterministic order — created_at asc, event-id tiebreak — so
 *  hydrate-then-live and live-then-hydrate converge on identical arrays
 *  (identical buildChatRows output → no reorder on merge). */
export function compareChatEvents(a: NostrEvent, b: NostrEvent): number {
  return a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function insertSorted(list: NostrEvent[], event: NostrEvent): NostrEvent[] {
  if (list.some((e) => e.id === event.id)) return list;
  const next = [...list, event].sort(compareChatEvents);
  return next.length > MAX_CHANNEL_MESSAGES
    ? next.slice(-MAX_CHANNEL_MESSAGES)
    : next;
}

export const spaceChatSlice = createSlice({
  name: "spaceChat",
  initialState,
  reducers: {
    /** A verified, channel-matched message (backlog or live). */
    chatMessageReceived(
      state,
      action: PayloadAction<{ spaceId: string; channelId: string; event: NostrEvent }>,
    ) {
      const { spaceId, channelId, event } = action.payload;
      const key = channelKey(spaceId, channelId);
      state.byChannel[key] = insertSorted(state.byChannel[key] ?? [], event);
    },

    /** Stored backlog — MERGE with whatever live events already landed (the
     *  socket can beat the SQLite read); an empty row still marks the key
     *  hydrated so the read isn't repeated. */
    channelBacklogHydrated(
      state,
      action: PayloadAction<{ spaceId: string; channelId: string; events: NostrEvent[] }>,
    ) {
      const { spaceId, channelId, events } = action.payload;
      const key = channelKey(spaceId, channelId);
      let list = state.byChannel[key] ?? [];
      for (const event of events) list = insertSorted(list, event);
      state.byChannel[key] = list;
      state.hydrated[key] = true;
    },

    /** Leaving a space drops its cached channels (SQLite purge is the
     *  purgeSpaceChat thunk's job). */
    spaceBacklogPurged(state, action: PayloadAction<string>) {
      const prefix = `${action.payload}/`;
      for (const key of Object.keys(state.byChannel)) {
        if (key.startsWith(prefix)) delete state.byChannel[key];
      }
      for (const key of Object.keys(state.hydrated)) {
        if (key.startsWith(prefix)) delete state.hydrated[key];
      }
    },

    /** Logout / account switch. */
    spaceChatCleared() {
      return initialState;
    },
  },
});

export const {
  chatMessageReceived,
  channelBacklogHydrated,
  spaceBacklogPurged,
  spaceChatCleared,
} = spaceChatSlice.actions;

// ─── Selectors (structurally typed to avoid the store/index.ts cycle) ──

interface WithSpaceChat {
  spaceChat: SpaceChatState;
}

const EMPTY_MESSAGES: NostrEvent[] = [];

export function selectChannelMessages(
  state: WithSpaceChat,
  spaceId: string,
  channelId: string,
): NostrEvent[] {
  return state.spaceChat.byChannel[channelKey(spaceId, channelId)] ?? EMPTY_MESSAGES;
}

export function selectChannelHydrated(
  state: WithSpaceChat,
  spaceId: string,
  channelId: string,
): boolean {
  return state.spaceChat.hydrated[channelKey(spaceId, channelId)] === true;
}
