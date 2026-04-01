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
  repostsByAuthor: Record<string, string[]>; // pubkey -> repost eventIds
  quotes: Record<string, string[]>; // targetEventId -> quote eventIds
  /** Locally hidden message IDs (delete for me) */
  deletedMessageIds: Record<string, true>;
  /** originalEventId -> editEventId (latest edit wins) */
  editedMessages: Record<string, string>;
  /** Event IDs that have been deleted via kind:5 — prevents re-delivery from relays */
  deletedNoteIds: Record<string, true>;
  /** Addressable IDs deleted via kind:5 "a" tags — maps addr to deletion created_at.
   *  Prevents re-delivered addressable events (music) from external relays. */
  deletedAddrIds: Record<string, number>;
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
  repostsByAuthor: {},
  quotes: {},
  deletedMessageIds: {},
  editedMessages: {},
  deletedNoteIds: {},
  deletedAddrIds: {},
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
    indexRepostByAuthor(
      state,
      action: PayloadAction<{ pubkey: string; eventId: string }>,
    ) {
      pushToIndex(
        state.repostsByAuthor,
        action.payload.pubkey,
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
    /** Locally hide a message (delete for me) */
    hideMessage(state, action: PayloadAction<string>) {
      state.deletedMessageIds[action.payload] = true;
    },
    /** Restore persisted deleted message IDs on startup */
    restoreDeletedMessageIds(state, action: PayloadAction<Record<string, true>>) {
      state.deletedMessageIds = action.payload;
    },
    /** Remove a chat message from the secondary index */
    removeChatMessage(
      state,
      action: PayloadAction<{ contextId: string; eventId: string }>,
    ) {
      const { contextId, eventId } = action.payload;
      const list = state.chatMessages[contextId];
      if (list) {
        state.chatMessages[contextId] = list.filter((id) => id !== eventId);
      }
    },
    /** Remove a repost from the repostsByAuthor secondary index */
    removeRepost(
      state,
      action: PayloadAction<{ pubkey: string; eventId: string }>,
    ) {
      const { pubkey, eventId } = action.payload;
      const list = state.repostsByAuthor[pubkey];
      if (list) {
        state.repostsByAuthor[pubkey] = list.filter((id) => id !== eventId);
      }
    },
    /** Remove a note from the notesByAuthor secondary index */
    removeNote(
      state,
      action: PayloadAction<{ pubkey: string; eventId: string }>,
    ) {
      const { pubkey, eventId } = action.payload;
      const list = state.notesByAuthor[pubkey];
      if (list) {
        state.notesByAuthor[pubkey] = list.filter((id) => id !== eventId);
      }
    },
    /** Map an original event to its edit replacement */
    indexEditedMessage(
      state,
      action: PayloadAction<{ originalId: string; editEventId: string }>,
    ) {
      state.editedMessages[action.payload.originalId] = action.payload.editEventId;
    },
    /** Track a deleted note/repost ID to prevent re-delivery from relays */
    trackDeletedNote(state, action: PayloadAction<string>) {
      state.deletedNoteIds[action.payload] = true;
    },
    /** Track a deleted addressable ID with its deletion timestamp.
     *  Events with created_at <= deletedAt are rejected on re-delivery. */
    trackDeletedAddr(state, action: PayloadAction<{ addr: string; deletedAt: number }>) {
      const prev = state.deletedAddrIds[action.payload.addr] ?? 0;
      state.deletedAddrIds[action.payload.addr] = Math.max(prev, action.payload.deletedAt);
    },
    /** Bulk restore deleted addressable IDs from persisted deletion events on startup */
    restoreDeletedAddrIds(state, action: PayloadAction<Record<string, number>>) {
      for (const [addr, ts] of Object.entries(action.payload)) {
        const prev = state.deletedAddrIds[addr] ?? 0;
        state.deletedAddrIds[addr] = Math.max(prev, ts);
      }
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
  indexRepostByAuthor,
  indexQuote,
  hideMessage,
  restoreDeletedMessageIds,
  removeChatMessage,
  removeNote,
  removeRepost,
  indexEditedMessage,
  trackDeletedNote,
  trackDeletedAddr,
  restoreDeletedAddrIds,
} = eventsSlice.actions;
