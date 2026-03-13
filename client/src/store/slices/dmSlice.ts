import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface DMMessage {
  id: string;
  senderPubkey: string;
  content: string;
  createdAt: number;
  wrapId: string;
}

export interface DMContact {
  pubkey: string;
  lastMessageAt: number;
  lastMessagePreview: string;
  unreadCount: number;
}

interface DMState {
  contacts: DMContact[];
  messages: Record<string, DMMessage[]>;
  activeConversation: string | null;
  loading: boolean;
  processedWrapIds: string[];
  /** Captured unread count when opening a conversation, for divider positioning */
  unreadDividers: Record<string, number>;
}

const initialState: DMState = {
  contacts: [],
  messages: {},
  activeConversation: null,
  loading: false,
  processedWrapIds: [],
  unreadDividers: {},
};

export const dmSlice = createSlice({
  name: "dm",
  initialState,
  reducers: {
    addDMMessage(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        message: DMMessage;
        myPubkey: string;
      }>,
    ) {
      const { partnerPubkey, message, myPubkey } = action.payload;
      const isOwnMessage = message.senderPubkey === myPubkey;

      // Dedup by wrapId
      if (state.processedWrapIds.includes(message.wrapId)) return;
      state.processedWrapIds.push(message.wrapId);
      // Keep processedWrapIds bounded
      if (state.processedWrapIds.length > 5000) {
        state.processedWrapIds = state.processedWrapIds.slice(-3000);
      }

      // Add message (secondary dedup: skip if wrapId already in message list,
      // guards against processedWrapIds rolling over on very long histories)
      if (!state.messages[partnerPubkey]) {
        state.messages[partnerPubkey] = [];
      }
      if (state.messages[partnerPubkey].some((m) => m.wrapId === message.wrapId)) return;
      state.messages[partnerPubkey].push(message);
      // Sort by createdAt ascending
      state.messages[partnerPubkey].sort((a, b) => a.createdAt - b.createdAt);

      // Update contact
      const contactIdx = state.contacts.findIndex((c) => c.pubkey === partnerPubkey);
      const preview =
        message.content.length > 50
          ? message.content.slice(0, 50) + "..."
          : message.content;

      if (contactIdx >= 0) {
        const contact = state.contacts[contactIdx];
        if (message.createdAt >= contact.lastMessageAt) {
          contact.lastMessageAt = message.createdAt;
          contact.lastMessagePreview = preview;
        }
        // Only bump unread for incoming messages when not viewing the conversation
        if (!isOwnMessage && state.activeConversation !== partnerPubkey) {
          contact.unreadCount += 1;
        }
      } else {
        const isUnread = !isOwnMessage && state.activeConversation !== partnerPubkey;
        state.contacts.push({
          pubkey: partnerPubkey,
          lastMessageAt: message.createdAt,
          lastMessagePreview: preview,
          unreadCount: isUnread ? 1 : 0,
        });
      }

      // Sort contacts by lastMessageAt desc
      state.contacts.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    },

    setActiveConversation(state, action: PayloadAction<string | null>) {
      state.activeConversation = action.payload;

      // Capture unread count for divider, then mark as read
      if (action.payload) {
        const contact = state.contacts.find((c) => c.pubkey === action.payload);
        if (contact) {
          if (contact.unreadCount > 0) {
            state.unreadDividers[action.payload] = contact.unreadCount;
          }
          contact.unreadCount = 0;
        }
      }
    },

    markConversationRead(state, action: PayloadAction<string>) {
      const contact = state.contacts.find((c) => c.pubkey === action.payload);
      if (contact) {
        contact.unreadCount = 0;
      }
    },

    clearDMUnreadDivider(state, action: PayloadAction<string>) {
      delete state.unreadDividers[action.payload];
    },

    setDMLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },

    /** Delete a single message locally by wrapId */
    deleteDMMessage(
      state,
      action: PayloadAction<{ partnerPubkey: string; wrapId: string }>,
    ) {
      const { partnerPubkey, wrapId } = action.payload;
      const msgs = state.messages[partnerPubkey];
      if (!msgs) return;
      state.messages[partnerPubkey] = msgs.filter((m) => m.wrapId !== wrapId);

      // Update contact preview if we deleted the latest message
      const remaining = state.messages[partnerPubkey];
      const contact = state.contacts.find((c) => c.pubkey === partnerPubkey);
      if (contact && remaining.length > 0) {
        const last = remaining[remaining.length - 1];
        contact.lastMessageAt = last.createdAt;
        contact.lastMessagePreview =
          last.content.length > 50
            ? last.content.slice(0, 50) + "..."
            : last.content;
      } else if (contact && remaining.length === 0) {
        // No messages left — remove the contact entirely
        state.contacts = state.contacts.filter((c) => c.pubkey !== partnerPubkey);
        delete state.messages[partnerPubkey];
      }
    },

    /** Delete an entire conversation locally */
    deleteDMConversation(state, action: PayloadAction<string>) {
      const pubkey = action.payload;
      delete state.messages[pubkey];
      state.contacts = state.contacts.filter((c) => c.pubkey !== pubkey);
      delete state.unreadDividers[pubkey];
      if (state.activeConversation === pubkey) {
        state.activeConversation = null;
      }
    },

    /** Bulk-restore persisted DM state from IndexedDB on startup.
     *  Filters out corrupted messages (e.g. undecrypted ciphertext that leaked
     *  through due to NIP-07 extension bugs). */
    restoreDMState(
      state,
      action: PayloadAction<{
        messages?: Record<string, DMMessage[]>;
        contacts?: DMContact[];
        processedWrapIds?: string[];
      }>,
    ) {
      const { messages, contacts, processedWrapIds } = action.payload;

      if (messages) {
        // Scrub corrupted messages: reject entries whose content is
        // entirely base64 (likely undecrypted NIP-44 ciphertext)
        const BASE64_ONLY = /^[A-Za-z0-9+/=]+$/;
        const cleaned: Record<string, DMMessage[]> = {};
        for (const [pubkey, msgs] of Object.entries(messages)) {
          const valid = msgs.filter(
            (m) =>
              typeof m.content === "string" &&
              !(m.content.length > 50 && BASE64_ONLY.test(m.content)),
          );
          if (valid.length > 0) cleaned[pubkey] = valid;
        }
        state.messages = cleaned;

        // Rebuild contacts to match cleaned messages (drop contacts with no valid messages)
        if (contacts) {
          state.contacts = contacts.filter((c) => cleaned[c.pubkey]?.length);
        }
      } else if (contacts) {
        state.contacts = contacts;
      }

      if (processedWrapIds) state.processedWrapIds = processedWrapIds;
    },
  },
});

export const {
  addDMMessage,
  setActiveConversation,
  markConversationRead,
  clearDMUnreadDivider,
  setDMLoading,
  deleteDMMessage,
  deleteDMConversation,
  restoreDMState,
} = dmSlice.actions;
