// NIP-17 DM state — a trimmed port of the desktop dmSlice (edits/deletes/
// relay-synced read state arrive later): conversations keyed by peer pubkey
// + per-peer message lists, with wrap-id dedup so live delivery, SQLite
// hydration, and self-wrap relay echoes apply at most once.
//
// PRIVACY: message content in this slice is decrypted rumor plaintext. It
// must never be logged and never leaves the device except as gift wraps.

import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Own-message delivery state (incoming messages have none). */
export type DMSendStatus = "pending" | "sent" | "failed";

export interface DMMessage {
  /** = wrapId (self-wrap id for own messages, incoming wrap id for theirs). */
  id: string;
  senderPubkey: string;
  content: string;
  /** The rumor's real send time (seal/wrap timestamps are randomized). */
  createdAt: number;
  wrapId: string;
  /** The rumor id — shared across recipient + self wraps; edit/delete anchor. */
  rumorId?: string;
  status?: DMSendStatus;
}

export interface DMConversation {
  pubkey: string;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
}

interface DMState {
  conversations: DMConversation[];
  /** peer pubkey → ascending-createdAt message list. */
  messages: Record<string, DMMessage[]>;
  activeConversation: string | null;
  processedWrapIds: string[];
  /** O(1) lookup mirror of processedWrapIds. */
  processedWrapIdSet: Record<string, true>;
  hydrated: boolean;
}

const initialState: DMState = {
  conversations: [],
  messages: {},
  activeConversation: null,
  processedWrapIds: [],
  processedWrapIdSet: {},
  hydrated: false,
};

function truncatePreview(text: string, max = 60): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/** Record a wrap id as processed. Returns false when already seen. Bounded. */
function markWrapProcessed(state: DMState, wrapId: string): boolean {
  if (state.processedWrapIdSet[wrapId]) return false;
  state.processedWrapIds.push(wrapId);
  state.processedWrapIdSet[wrapId] = true;
  if (state.processedWrapIds.length > 5000) {
    const evicted = state.processedWrapIds.splice(0, state.processedWrapIds.length - 3000);
    for (const id of evicted) delete state.processedWrapIdSet[id];
  }
  return true;
}

/** Insert a message in ascending createdAt order (binary search). */
function insertSorted(arr: DMMessage[], msg: DMMessage): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].createdAt < msg.createdAt) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, msg);
}

/** Insert a conversation in descending lastMessageAt order. */
function insertConversationSorted(arr: DMConversation[], convo: DMConversation): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].lastMessageAt > convo.lastMessageAt) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, convo);
}

function applyMessage(
  state: DMState,
  partnerPubkey: string,
  message: DMMessage,
  isOwnMessage: boolean,
): void {
  if (!markWrapProcessed(state, message.wrapId)) return;

  if (!state.messages[partnerPubkey]) state.messages[partnerPubkey] = [];
  // Secondary dedup guards against processedWrapIds eviction on long histories.
  if (state.messages[partnerPubkey].some((m) => m.wrapId === message.wrapId)) return;
  insertSorted(state.messages[partnerPubkey], message);

  const preview = truncatePreview(message.content);
  const idx = state.conversations.findIndex((c) => c.pubkey === partnerPubkey);
  if (idx >= 0) {
    const convo = state.conversations[idx];
    if (message.createdAt >= convo.lastMessageAt) {
      convo.lastMessageAt = message.createdAt;
      convo.lastMessagePreview = preview;
    }
    if (!isOwnMessage && state.activeConversation !== partnerPubkey) {
      convo.unreadCount += 1;
    }
    state.conversations.splice(idx, 1);
    insertConversationSorted(state.conversations, convo);
  } else {
    insertConversationSorted(state.conversations, {
      pubkey: partnerPubkey,
      lastMessageAt: message.createdAt,
      lastMessagePreview: preview,
      unreadCount: !isOwnMessage && state.activeConversation !== partnerPubkey ? 1 : 0,
    });
  }
}

export const dmSlice = createSlice({
  name: "dm",
  initialState,
  reducers: {
    /** A decrypted incoming (or echoed own) message from the wrap sub. */
    dmMessageReceived(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        myPubkey: string;
        message: DMMessage;
      }>,
    ) {
      const { partnerPubkey, myPubkey, message } = action.payload;
      applyMessage(state, partnerPubkey, message, message.senderPubkey === myPubkey);
    },

    /** Optimistic insert for an outgoing message (status: pending). */
    dmSendStarted(
      state,
      action: PayloadAction<{ partnerPubkey: string; message: DMMessage }>,
    ) {
      const { partnerPubkey, message } = action.payload;
      applyMessage(state, partnerPubkey, { ...message, status: "pending" }, true);
    },

    /** Relay OK (or timeout) for an outgoing message. */
    dmSendResolved(
      state,
      action: PayloadAction<{ partnerPubkey: string; wrapId: string; ok: boolean }>,
    ) {
      const { partnerPubkey, wrapId, ok } = action.payload;
      const msg = state.messages[partnerPubkey]?.find((m) => m.wrapId === wrapId);
      if (msg && msg.status === "pending") msg.status = ok ? "sent" : "failed";
    },

    /** Opening/leaving a conversation — manages the unread counter. */
    setActiveDMConversation(state, action: PayloadAction<string | null>) {
      state.activeConversation = action.payload;
      if (action.payload) {
        const convo = state.conversations.find((c) => c.pubkey === action.payload);
        if (convo) convo.unreadCount = 0;
      }
    },

    /** Remove a conversation locally (block flow). */
    dmConversationRemoved(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      delete state.messages[pubkey];
      state.conversations = state.conversations.filter((c) => c.pubkey !== pubkey);
      if (state.activeConversation === pubkey) state.activeConversation = null;
    },

    /** Bulk-restore from SQLite before the network sub opens. Scrubs entries
     *  whose content is still base64 ciphertext (defense in depth — unwrap
     *  already fails closed). Live messages that raced hydration win by
     *  wrap-id dedup. */
    dmHydrated(
      state,
      action: PayloadAction<{
        messagesByPeer: Record<string, DMMessage[]>;
        processedWrapIds?: string[];
      }>,
    ) {
      const { messagesByPeer, processedWrapIds } = action.payload;
      const BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;
      if (processedWrapIds) {
        for (const id of processedWrapIds) {
          if (!state.processedWrapIdSet[id]) {
            state.processedWrapIds.push(id);
            state.processedWrapIdSet[id] = true;
          }
        }
      }
      for (const [peer, msgs] of Object.entries(messagesByPeer)) {
        for (const msg of msgs) {
          if (typeof msg.content !== "string") continue;
          if (msg.content.length > 50 && BASE64_ONLY.test(msg.content)) continue;
          // A pending message from a previous session will never resolve.
          const restored = msg.status === "pending" ? { ...msg, status: "failed" as const } : msg;
          // Hydration must apply even when the wrap id was pre-registered via
          // processedWrapIds — bypass the processed set, dedup per-list only.
          if (!state.messages[peer]) state.messages[peer] = [];
          if (state.messages[peer].some((m) => m.wrapId === restored.wrapId)) continue;
          insertSorted(state.messages[peer], restored);
          state.processedWrapIdSet[restored.wrapId] = true;
          if (!state.processedWrapIds.includes(restored.wrapId)) {
            state.processedWrapIds.push(restored.wrapId);
          }
        }
      }
      // Rebuild conversation rows from the restored lists (unread counts reset
      // to 0 — anything persisted was seen or will re-notify on live arrival).
      for (const [peer, msgs] of Object.entries(state.messages)) {
        if (msgs.length === 0) continue;
        if (state.conversations.some((c) => c.pubkey === peer)) continue;
        const last = msgs[msgs.length - 1];
        insertConversationSorted(state.conversations, {
          pubkey: peer,
          lastMessageAt: last.createdAt,
          lastMessagePreview: truncatePreview(last.content),
          unreadCount: 0,
        });
      }
      state.hydrated = true;
    },

    /** Logout / account switch — decrypted content must not linger. */
    dmCleared() {
      return initialState;
    },
  },
});

export const {
  dmMessageReceived,
  dmSendStarted,
  dmSendResolved,
  setActiveDMConversation,
  dmConversationRemoved,
  dmHydrated,
  dmCleared,
} = dmSlice.actions;
