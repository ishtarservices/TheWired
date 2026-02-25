import {
  createSlice,
  createEntityAdapter,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { NostrEvent } from "../../types/nostr";

const eventsAdapter = createEntityAdapter<NostrEvent, string>({
  selectId: (event) => event.id,
  sortComparer: (a, b) => a.created_at - b.created_at,
});

interface EventsExtraState {
  chatMessages: Record<string, string[]>; // groupId -> eventId[]
  reels: Record<string, string[]>;
  longform: Record<string, string[]>;
  liveStreams: Record<string, string[]>;
  notesByAuthor: Record<string, string[]>; // pubkey -> eventId[]
  spaceFeeds: Record<string, string[]>; // `${spaceId}:${channelType}` -> eventId[]
  musicTracks: Record<string, string[]>; // contextId -> eventId[]
  musicAlbums: Record<string, string[]>; // contextId -> eventId[]
  reactions: Record<string, string[]>; // targetEventId -> reaction eventIds
  replies: Record<string, string[]>; // parentEventId -> reply eventIds
  reposts: Record<string, string[]>; // targetEventId -> repost eventIds
  quotes: Record<string, string[]>; // targetEventId -> quote eventIds
}

const initialState = eventsAdapter.getInitialState<EventsExtraState>({
  chatMessages: {},
  reels: {},
  longform: {},
  liveStreams: {},
  notesByAuthor: {},
  spaceFeeds: {},
  musicTracks: {},
  musicAlbums: {},
  reactions: {},
  replies: {},
  reposts: {},
  quotes: {},
});

/** Max events per feed index to prevent unbounded memory growth */
const FEED_INDEX_CAP = 500;

function pushToIndex(
  index: Record<string, string[]>,
  contextId: string,
  eventId: string,
  cap = 0,
) {
  if (!index[contextId]) {
    index[contextId] = [];
  }
  if (!index[contextId].includes(eventId)) {
    index[contextId].push(eventId);
    // Trim oldest entries if over cap
    if (cap > 0 && index[contextId].length > cap) {
      index[contextId] = index[contextId].slice(-cap);
    }
  }
}

export const eventsSlice = createSlice({
  name: "events",
  initialState,
  reducers: {
    addEvent(state, action: PayloadAction<NostrEvent>) {
      eventsAdapter.upsertOne(state, action.payload);
    },
    addEvents(state, action: PayloadAction<NostrEvent[]>) {
      eventsAdapter.upsertMany(state, action.payload);
    },
    removeEvent(state, action: PayloadAction<string>) {
      eventsAdapter.removeOne(state, action.payload);
    },
    indexChatMessage(
      state,
      action: PayloadAction<{ groupId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.chatMessages,
        action.payload.groupId,
        action.payload.eventId,
      );
    },
    indexReel(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.reels,
        action.payload.contextId,
        action.payload.eventId,
      );
    },
    indexLongForm(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.longform,
        action.payload.contextId,
        action.payload.eventId,
      );
    },
    indexLiveStream(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.liveStreams,
        action.payload.contextId,
        action.payload.eventId,
      );
    },
    indexNote(
      state,
      action: PayloadAction<{ pubkey: string; eventId: string }>,
    ) {
      pushToIndex(
        state.notesByAuthor,
        action.payload.pubkey,
        action.payload.eventId,
      );
    },
    indexSpaceFeed(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.spaceFeeds,
        action.payload.contextId,
        action.payload.eventId,
        FEED_INDEX_CAP,
      );
    },
    clearSpaceFeed(state, action: PayloadAction<string>) {
      delete state.spaceFeeds[action.payload];
    },
    indexMusicTrack(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.musicTracks,
        action.payload.contextId,
        action.payload.eventId,
      );
    },
    indexMusicAlbum(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.musicAlbums,
        action.payload.contextId,
        action.payload.eventId,
      );
    },
    indexReaction(
      state,
      action: PayloadAction<{ targetEventId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.reactions,
        action.payload.targetEventId,
        action.payload.eventId,
      );
    },
    indexReply(
      state,
      action: PayloadAction<{ parentEventId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.replies,
        action.payload.parentEventId,
        action.payload.eventId,
      );
    },
    indexRepost(
      state,
      action: PayloadAction<{ targetEventId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.reposts,
        action.payload.targetEventId,
        action.payload.eventId,
      );
    },
    indexQuote(
      state,
      action: PayloadAction<{ targetEventId: string; eventId: string }>,
    ) {
      pushToIndex(
        state.quotes,
        action.payload.targetEventId,
        action.payload.eventId,
      );
    },
  },
});

export const eventsSelectors = eventsAdapter.getSelectors();

export const {
  addEvent,
  addEvents,
  removeEvent,
  indexChatMessage,
  indexReel,
  indexLongForm,
  indexLiveStream,
  indexNote,
  indexSpaceFeed,
  clearSpaceFeed,
  indexMusicTrack,
  indexMusicAlbum,
  indexReaction,
  indexReply,
  indexRepost,
  indexQuote,
} = eventsSlice.actions;
