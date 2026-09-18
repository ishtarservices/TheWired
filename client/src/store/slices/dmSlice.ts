import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { summarizeContent } from "../../lib/content/contentPreview";

export interface DMMessage {
  id: string;
  senderPubkey: string;
  content: string;
  createdAt: number;
  wrapId: string;
  /** The rumor ID — used to reference this message for edits/deletes */
  rumorId?: string;
  /** Edited content (replaces display of `content`) */
  editedContent?: string;
  /** Timestamp when the message was edited */
  editedAt?: number;
  /** Whether this message was remotely deleted */
  isDeleted?: boolean;
  /**
   * The reply anchor: the rumor's `q` tag value. Current clients (web + mobile)
   * write the target message's *rumorId* — the only id both parties share
   * (each side holds a different gift-wrap id for the same rumor). Messages
   * from older clients carry a wrapId here instead, so readers resolve
   * rumorId-first, wrapId-fallback (`resolveDMReplyTarget`). Field name kept
   * for persistence compatibility.
   */
  replyToWrapId?: string;
  /** NIP-30 emoji tags for custom emojis in this message */
  emojiTags?: string[][];
  /**
   * Emoji reactions: unicode emoji → reactor pubkeys. Delivered as NIP-17
   * typed rumors (`dm_reaction` / `dm_reaction_remove`) anchored on this
   * message's rumorId. At most MAX_DM_REACTION_EMOJI distinct emoji.
   */
  reactions?: Record<string, string[]>;
}

/** Distinct emoji cap per DM message (matches the mobile client). */
export const MAX_DM_REACTION_EMOJI = 16;
/** Reactions that arrived before their target message, keyed by rumorId. */
const MAX_PENDING_DM_REACTION_TARGETS = 500;

interface PendingDMReaction {
  emoji: string;
  reactor: string;
  remove: boolean;
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
  /** O(1) lookup mirror of processedWrapIds */
  processedWrapIdSet: Record<string, true>;
  /** Captured unread count when opening a conversation, for divider positioning */
  unreadDividers: Record<string, number>;
  /** Per-conversation timestamp of last read, synced to relays via NIP-78 */
  lastReadTimestamps: Record<string, number>;
  /** Monotonic counter bumped on every mutation — drives persistence fingerprint */
  mutationCounter: number;
  /** Reactions whose target rumor hasn't arrived yet (cold start delivers
   *  newest-first). Drained by addDMMessage. In-memory only. */
  pendingReactions: Record<string, PendingDMReaction[]>;
}

const initialState: DMState = {
  contacts: [],
  messages: {},
  activeConversation: null,
  loading: false,
  processedWrapIds: [],
  processedWrapIdSet: {},
  unreadDividers: {},
  lastReadTimestamps: {},
  mutationCounter: 0,
  pendingReactions: {},
};

/** Build a friendly one-line message preview: summarize noisy refs/URLs, then truncate */
function truncatePreview(text: string, max = 50): string {
  const summary = summarizeContent(text);
  return summary.length > max ? summary.slice(0, max) + "..." : summary;
}

/** Record a gift-wrap id as processed. Returns false if it was already seen
 *  (so edit/delete wraps — like messages — apply at most once). Bounded-eviction
 *  mirrors addDMMessage. */
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

/** Apply one reaction add/remove to a message. Returns whether anything changed.
 *  Adds are reactor-deduped and capped at MAX_DM_REACTION_EMOJI distinct emoji
 *  (an emoji already on the message still accepts new reactors). */
function applyDMReaction(
  msg: DMMessage,
  emoji: string,
  reactor: string,
  remove: boolean,
): boolean {
  if (remove) {
    const list = msg.reactions?.[emoji];
    if (!list) return false;
    const next = list.filter((p) => p !== reactor);
    if (next.length === list.length) return false;
    if (next.length > 0) {
      msg.reactions![emoji] = next;
    } else {
      delete msg.reactions![emoji];
      if (Object.keys(msg.reactions!).length === 0) delete msg.reactions;
    }
    return true;
  }
  const reactions = msg.reactions ?? (msg.reactions = {});
  let list = reactions[emoji];
  if (!list) {
    if (Object.keys(reactions).length >= MAX_DM_REACTION_EMOJI) return false;
    list = reactions[emoji] = [];
  }
  if (list.includes(reactor)) return false;
  list.push(reactor);
  return true;
}

/** Queue a reaction for a rumor we haven't seen yet (bounded, oldest evicted). */
function bufferPendingReaction(state: DMState, rumorId: string, r: PendingDMReaction): void {
  const list = state.pendingReactions[rumorId] ?? (state.pendingReactions[rumorId] = []);
  list.push(r);
  const keys = Object.keys(state.pendingReactions);
  if (keys.length > MAX_PENDING_DM_REACTION_TARGETS) {
    for (const k of keys.slice(0, keys.length - MAX_PENDING_DM_REACTION_TARGETS)) {
      delete state.pendingReactions[k];
    }
  }
}

/** Shared body of reactDMMessage / removeDMReaction. */
function handleDMReaction(
  state: DMState,
  payload: {
    partnerPubkey: string;
    rumorId: string;
    emoji: string;
    reactorPubkey: string;
    wrapId?: string;
  },
  remove: boolean,
): void {
  const { partnerPubkey, rumorId, reactorPubkey, wrapId } = payload;
  const emoji = payload.emoji.trim();
  if (!emoji) return;
  // Dedup the reaction wrap (no-op on the self-wrap echo of an optimistic react).
  if (wrapId && !markWrapProcessed(state, wrapId)) return;

  // Match by rumorId first, fall back to wrapId for legacy messages.
  const msgs = state.messages[partnerPubkey];
  const msg = msgs?.find((m) => m.rumorId === rumorId)
    ?? msgs?.find((m) => m.wrapId === rumorId);
  if (!msg) {
    // Target not here yet (or ever) — keep it so a late-arriving message
    // picks it up instead of losing the reaction for good.
    bufferPendingReaction(state, rumorId, { emoji, reactor: reactorPubkey, remove });
    return;
  }
  if (applyDMReaction(msg, emoji, reactorPubkey, remove)) {
    state.mutationCounter += 1;
  }
}

/** Insert a message in sorted (ascending createdAt) order via binary search */
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

/** Insert a contact in sorted (descending lastMessageAt) order */
function insertContactSorted(arr: DMContact[], contact: DMContact): void {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid].lastMessageAt > contact.lastMessageAt) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, contact);
}

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

      // O(1) dedup via lookup map
      if (state.processedWrapIdSet[message.wrapId]) return;
      state.processedWrapIds.push(message.wrapId);
      state.processedWrapIdSet[message.wrapId] = true;

      // Keep processedWrapIds bounded
      if (state.processedWrapIds.length > 5000) {
        const evicted = state.processedWrapIds.splice(0, state.processedWrapIds.length - 3000);
        for (const id of evicted) {
          delete state.processedWrapIdSet[id];
        }
      }

      // Add message (secondary dedup: skip if wrapId already in message list,
      // guards against processedWrapIds rolling over on very long histories)
      if (!state.messages[partnerPubkey]) {
        state.messages[partnerPubkey] = [];
      }
      if (state.messages[partnerPubkey].some((m) => m.wrapId === message.wrapId)) return;

      // Binary insert instead of push+sort
      insertSorted(state.messages[partnerPubkey], message);

      // Drain reactions that arrived ahead of this message.
      if (message.rumorId && state.pendingReactions[message.rumorId]) {
        for (const r of state.pendingReactions[message.rumorId]) {
          applyDMReaction(message, r.emoji, r.reactor, r.remove);
        }
        delete state.pendingReactions[message.rumorId];
      }

      // Update contact
      const contactIdx = state.contacts.findIndex((c) => c.pubkey === partnerPubkey);
      const preview = truncatePreview(message.content);

      if (contactIdx >= 0) {
        const contact = state.contacts[contactIdx];
        if (message.createdAt >= contact.lastMessageAt) {
          contact.lastMessageAt = message.createdAt;
          contact.lastMessagePreview = preview;
        }
        // Only bump unread for incoming messages when not viewing the conversation
        // and the message is newer than the last-read timestamp (from relay-synced read state)
        if (!isOwnMessage && state.activeConversation !== partnerPubkey) {
          const lastRead = state.lastReadTimestamps[partnerPubkey];
          if (!lastRead || message.createdAt > lastRead) {
            contact.unreadCount += 1;
          }
        }
        // Re-sort: remove and re-insert at correct position
        state.contacts.splice(contactIdx, 1);
        insertContactSorted(state.contacts, contact);
      } else {
        const lastRead = state.lastReadTimestamps[partnerPubkey];
        const isUnread = !isOwnMessage
          && state.activeConversation !== partnerPubkey
          && (!lastRead || message.createdAt > lastRead);
        const newContact: DMContact = {
          pubkey: partnerPubkey,
          lastMessageAt: message.createdAt,
          lastMessagePreview: preview,
          unreadCount: isUnread ? 1 : 0,
        };
        insertContactSorted(state.contacts, newContact);
      }

      state.mutationCounter += 1;
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
        // Record read timestamp for relay sync (NIP-78)
        state.lastReadTimestamps[action.payload] = Math.floor(Date.now() / 1000);
        state.mutationCounter += 1;
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
        contact.lastMessagePreview = truncatePreview(last.content);
      } else if (contact && remaining.length === 0) {
        // No messages left — remove the contact entirely
        state.contacts = state.contacts.filter((c) => c.pubkey !== partnerPubkey);
        delete state.messages[partnerPubkey];
      }

      state.mutationCounter += 1;
    },

    /** Edit a DM message (local state update).
     *  Ownership-gated (#23/#32): only the ORIGINAL author may edit — a DM partner
     *  cannot rewrite YOUR messages. senderPubkey is the inner rumor's author. */
    editDMMessage(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        rumorId: string;
        newContent: string;
        editedAt: number;
        senderPubkey: string;
        /** The edit wrap's id, for at-most-once application. */
        wrapId?: string;
      }>,
    ) {
      const { partnerPubkey, rumorId, newContent, editedAt, senderPubkey, wrapId } = action.payload;
      // Dedup the edit wrap (no-op on the self-wrap echo of an optimistic edit).
      if (wrapId && !markWrapProcessed(state, wrapId)) return;

      const msgs = state.messages[partnerPubkey];
      if (!msgs) return;
      // Match by rumorId first, fall back to wrapId for legacy messages
      const msg = msgs.find((m) => m.rumorId === rumorId)
        ?? msgs.find((m) => m.wrapId === rumorId);
      // Apply only when the editor authored the target message.
      if (!msg || msg.senderPubkey !== senderPubkey) return;

      msg.editedContent = newContent;
      msg.editedAt = editedAt;

      // #87: refresh the conversation-list preview when the latest message is edited.
      const contact = state.contacts.find((c) => c.pubkey === partnerPubkey);
      if (contact) {
        const lastVisible = [...msgs].reverse().find((m) => !m.isDeleted);
        if (lastVisible && lastVisible === msg) {
          contact.lastMessagePreview = truncatePreview(lastVisible.editedContent ?? lastVisible.content);
        }
      }
      state.mutationCounter += 1;
    },

    /** Mark a DM message as remotely deleted.
     *  Ownership-gated (#23/#32): only the original author may delete-for-everyone. */
    remoteDeleteDMMessage(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        rumorId: string;
        senderPubkey: string;
        wrapId?: string;
      }>,
    ) {
      const { partnerPubkey, rumorId, senderPubkey, wrapId } = action.payload;
      if (wrapId && !markWrapProcessed(state, wrapId)) return;

      const msgs = state.messages[partnerPubkey];
      if (!msgs) return;
      // Match by rumorId first, fall back to wrapId for legacy messages
      const msg = msgs.find((m) => m.rumorId === rumorId)
        ?? msgs.find((m) => m.wrapId === rumorId);
      if (!msg || msg.senderPubkey !== senderPubkey) return;

      msg.isDeleted = true;
      msg.content = "";
      msg.editedContent = undefined;

      // Update contact preview
      const contact = state.contacts.find((c) => c.pubkey === partnerPubkey);
      if (contact) {
        const lastVisible = [...msgs].reverse().find((m) => !m.isDeleted);
        if (lastVisible) {
          contact.lastMessagePreview = truncatePreview(lastVisible.editedContent ?? lastVisible.content);
        }
      }
      state.mutationCounter += 1;
    },

    /** Add an emoji reaction to a DM (typed rumor `dm_reaction`, anchored on the
     *  target's rumorId). Either party may react; the reactor is the rumor's
     *  author. wrapId dedupes the self-wrap echo of an optimistic react. */
    reactDMMessage(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        rumorId: string;
        emoji: string;
        reactorPubkey: string;
        wrapId?: string;
      }>,
    ) {
      handleDMReaction(state, action.payload, false);
    },

    /** Remove the reactor's emoji reaction (typed rumor `dm_reaction_remove`).
     *  Only the reactor's own entry is touched — you can't clear someone else's. */
    removeDMReaction(
      state,
      action: PayloadAction<{
        partnerPubkey: string;
        rumorId: string;
        emoji: string;
        reactorPubkey: string;
        wrapId?: string;
      }>,
    ) {
      handleDMReaction(state, action.payload, true);
    },

    /** Merge relay-synced read timestamps (NIP-78). Takes max per conversation. */
    applyRelayReadState(state, action: PayloadAction<Record<string, number>>) {
      const remote = action.payload;
      for (const [pubkey, ts] of Object.entries(remote)) {
        const local = state.lastReadTimestamps[pubkey];
        if (!local || ts > local) {
          state.lastReadTimestamps[pubkey] = ts;
        }
      }
      // Recompute unread counts based on merged timestamps
      for (const contact of state.contacts) {
        const lastRead = state.lastReadTimestamps[contact.pubkey];
        if (!lastRead) continue;
        const msgs = state.messages[contact.pubkey];
        if (!msgs) continue;
        // Count messages from the other person newer than lastRead
        // (we don't know myPubkey here, but own messages don't count toward unread
        //  regardless — they were sent by us and never incremented unread in the first place.
        //  So just zero out if lastRead >= lastMessageAt.)
        if (lastRead >= contact.lastMessageAt) {
          contact.unreadCount = 0;
        }
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
      state.mutationCounter += 1;
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
        lastReadTimestamps?: Record<string, number>;
      }>,
    ) {
      const { messages, contacts, processedWrapIds, lastReadTimestamps } = action.payload;

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

      if (processedWrapIds) {
        state.processedWrapIds = processedWrapIds;
        // Rebuild the O(1) lookup set
        const set: Record<string, true> = {};
        for (const id of processedWrapIds) {
          set[id] = true;
        }
        state.processedWrapIdSet = set;
      }

      if (lastReadTimestamps) {
        // Merge: take max per conversation
        for (const [pubkey, ts] of Object.entries(lastReadTimestamps)) {
          const existing = state.lastReadTimestamps[pubkey];
          if (!existing || ts > existing) {
            state.lastReadTimestamps[pubkey] = ts;
          }
        }
      }

      // If a conversation is currently being viewed (e.g. user navigated
      // before persistence finished loading), clear that contact's unread
      // count to prevent stale badges after restore.
      if (state.activeConversation) {
        const active = state.contacts.find(
          (c) => c.pubkey === state.activeConversation,
        );
        if (active && active.unreadCount > 0) {
          active.unreadCount = 0;
        }
      }
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
  editDMMessage,
  remoteDeleteDMMessage,
  reactDMMessage,
  removeDMReaction,
  applyRelayReadState,
  deleteDMConversation,
  restoreDMState,
} = dmSlice.actions;
