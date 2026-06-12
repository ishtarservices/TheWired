import {
  createEntityAdapter,
  createSelector,
  createSlice,
  type EntityState,
  type PayloadAction,
} from "@reduxjs/toolkit";
import type { RootState } from "../index";
import type {
  AIArtifact,
  AIContext,
  AIConversation,
  AIMessage,
  AIModelInfo,
  AIProviderConfig,
  AIProviderStatus,
  AIToolCall,
  AIToolResult,
  PendingWrite,
} from "@/types/ai";
import { DEFAULT_AI_PREFS, type AIPrefs } from "@/features/ai/aiPrefs";

/**
 * AI feature state. Two entity adapters (conversations, messages) plus a
 * per-conversation message index — mirrors `eventsSlice`'s adapter + secondary
 * indices. Display + persisted state only; API keys, raw provider clients, and
 * AbortControllers live in `llmManager`/`streamRunner`, never here.
 */

const conversationsAdapter = createEntityAdapter<AIConversation, string>({
  selectId: (c) => c.id,
  sortComparer: (a, b) => b.updatedAt - a.updatedAt, // most-recent first
});
const messagesAdapter = createEntityAdapter<AIMessage, string>({
  selectId: (m) => m.id,
});

interface AIState {
  conversations: EntityState<AIConversation, string>;
  messages: EntityState<AIMessage, string>;
  /** conversationId -> ordered messageId[] */
  messagesByConversation: Record<string, string[]>;
  artifacts: Record<string, AIArtifact>;
  artifactIdsByConversation: Record<string, string[]>;
  activeConversationId: string | null;
  /** conversationId -> in-flight stream (display only). */
  streamingByConversation: Record<
    string,
    { messageId: string; startedAt: number }
  >;
  /** Non-secret provider configs (display state; keys live in llmManager/keychain). */
  providers: Record<string, AIProviderConfig>;
  providerStatus: Record<string, AIProviderStatus>;
  openArtifactIdByConversation: Record<string, string | null>;
  composerDraftByConversation: Record<string, string>;
  /** Pending "Ask AI" context awaiting send (rendered as a composer chip).
   *  Display state only; refs are re-resolved against live Redux at send time. */
  pendingContext: AIContext | null;
  /** Model-proposed writes awaiting human approval (the agentic gate). */
  pendingWrites: Record<string, PendingWrite>;
  pendingWriteIdsByConversation: Record<string, string[]>;
  /** conversationIds whose messages have been hydrated from IndexedDB. */
  hydratedConversations: string[];
  prefs: AIPrefs;
}

const initialState: AIState = {
  conversations: conversationsAdapter.getInitialState(),
  messages: messagesAdapter.getInitialState(),
  messagesByConversation: {},
  artifacts: {},
  artifactIdsByConversation: {},
  activeConversationId: null,
  streamingByConversation: {},
  providers: {},
  providerStatus: {},
  openArtifactIdByConversation: {},
  composerDraftByConversation: {},
  pendingContext: null,
  pendingWrites: {},
  pendingWriteIdsByConversation: {},
  hydratedConversations: [],
  prefs: DEFAULT_AI_PREFS,
};

/** Append text to the last text part of a message, or start one. */
function pushText(message: AIMessage, text: string) {
  const last = message.parts[message.parts.length - 1];
  if (last && last.type === "text") last.text += text;
  else message.parts.push({ type: "text", text });
}

export const aiSlice = createSlice({
  name: "ai",
  initialState,
  reducers: {
    /** Replace all conversations (login hydration). */
    setConversations(state, action: PayloadAction<AIConversation[]>) {
      conversationsAdapter.setAll(state.conversations, action.payload);
    },
    upsertConversation(state, action: PayloadAction<AIConversation>) {
      conversationsAdapter.upsertOne(state.conversations, action.payload);
    },
    renameConversation(
      state,
      action: PayloadAction<{ id: string; title: string; updatedAt: number }>,
    ) {
      conversationsAdapter.updateOne(state.conversations, {
        id: action.payload.id,
        changes: { title: action.payload.title, updatedAt: action.payload.updatedAt },
      });
    },
    setConversationModel(
      state,
      action: PayloadAction<{
        conversationId: string;
        providerId: string;
        model: string;
      }>,
    ) {
      conversationsAdapter.updateOne(state.conversations, {
        id: action.payload.conversationId,
        changes: {
          providerId: action.payload.providerId,
          model: action.payload.model,
        },
      });
    },
    removeConversation(state, action: PayloadAction<string>) {
      const id = action.payload;
      const messageIds = state.messagesByConversation[id] ?? [];
      messagesAdapter.removeMany(state.messages, messageIds);
      delete state.messagesByConversation[id];
      conversationsAdapter.removeOne(state.conversations, id);
      for (const artifactId of state.artifactIdsByConversation[id] ?? []) {
        delete state.artifacts[artifactId];
      }
      delete state.artifactIdsByConversation[id];
      delete state.openArtifactIdByConversation[id];
      delete state.streamingByConversation[id];
      delete state.composerDraftByConversation[id];
      for (const writeId of state.pendingWriteIdsByConversation[id] ?? []) {
        delete state.pendingWrites[writeId];
      }
      delete state.pendingWriteIdsByConversation[id];
      state.hydratedConversations = state.hydratedConversations.filter(
        (c) => c !== id,
      );
      if (state.activeConversationId === id) state.activeConversationId = null;
    },
    setActiveConversation(state, action: PayloadAction<string | null>) {
      state.activeConversationId = action.payload;
    },

    /** Hydrate a conversation's persisted messages from IndexedDB. */
    setConversationMessages(
      state,
      action: PayloadAction<{ conversationId: string; messages: AIMessage[] }>,
    ) {
      const { conversationId, messages } = action.payload;
      messagesAdapter.upsertMany(state.messages, messages);
      state.messagesByConversation[conversationId] = messages
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => m.id);
      if (!state.hydratedConversations.includes(conversationId)) {
        state.hydratedConversations.push(conversationId);
      }
    },
    /** Evict an inactive conversation's messages from memory (IDB stays canonical). */
    evictConversationMessages(state, action: PayloadAction<string>) {
      const id = action.payload;
      if (state.activeConversationId === id || state.streamingByConversation[id])
        return;
      messagesAdapter.removeMany(
        state.messages,
        state.messagesByConversation[id] ?? [],
      );
      delete state.messagesByConversation[id];
      // Artifacts are derived from message text (deterministic ids) and are
      // re-synced on re-hydrate, so drop them too — otherwise they accumulate in
      // memory for every conversation ever opened this session.
      for (const artifactId of state.artifactIdsByConversation[id] ?? []) {
        delete state.artifacts[artifactId];
      }
      delete state.artifactIdsByConversation[id];
      delete state.openArtifactIdByConversation[id];
      state.hydratedConversations = state.hydratedConversations.filter(
        (c) => c !== id,
      );
    },

    addMessage(
      state,
      action: PayloadAction<{ message: AIMessage; bumpUpdatedAt?: number }>,
    ) {
      const { message, bumpUpdatedAt } = action.payload;
      messagesAdapter.upsertOne(state.messages, message);
      const index = (state.messagesByConversation[message.conversationId] ??= []);
      if (!index.includes(message.id)) index.push(message.id);
      if (bumpUpdatedAt !== undefined) {
        conversationsAdapter.updateOne(state.conversations, {
          id: message.conversationId,
          changes: { updatedAt: bumpUpdatedAt },
        });
      }
    },

    /** Add an empty assistant message and mark the conversation streaming. */
    startAssistantMessage(
      state,
      action: PayloadAction<{
        conversationId: string;
        messageId: string;
        createdAt: number;
      }>,
    ) {
      const { conversationId, messageId, createdAt } = action.payload;
      messagesAdapter.upsertOne(state.messages, {
        id: messageId,
        conversationId,
        role: "assistant",
        parts: [],
        status: "streaming",
        createdAt,
      });
      const index = (state.messagesByConversation[conversationId] ??= []);
      if (!index.includes(messageId)) index.push(messageId);
      state.streamingByConversation[conversationId] = { messageId, startedAt: createdAt };
    },
    appendAssistantDelta(
      state,
      action: PayloadAction<{ messageId: string; text: string }>,
    ) {
      const message = state.messages.entities[action.payload.messageId];
      if (message) pushText(message, action.payload.text);
    },
    appendReasoningDelta(
      state,
      action: PayloadAction<{ messageId: string; text: string }>,
    ) {
      const message = state.messages.entities[action.payload.messageId];
      if (message) message.reasoning = (message.reasoning ?? "") + action.payload.text;
    },
    setMessageToolCalls(
      state,
      action: PayloadAction<{ messageId: string; toolCalls: AIToolCall[] }>,
    ) {
      messagesAdapter.updateOne(state.messages, {
        id: action.payload.messageId,
        changes: { toolCalls: action.payload.toolCalls },
      });
    },
    setToolResult(
      state,
      action: PayloadAction<{
        messageId: string;
        toolCallId: string;
        result: AIToolResult;
      }>,
    ) {
      const message = state.messages.entities[action.payload.messageId];
      if (!message) return;
      message.toolResults = {
        ...(message.toolResults ?? {}),
        [action.payload.toolCallId]: action.payload.result,
      };
    },
    finishAssistantMessage(
      state,
      action: PayloadAction<{
        conversationId: string;
        messageId: string;
        usage?: AIMessage["usage"];
        genMs?: number;
        reasoningMs?: number;
        finishReason?: string;
      }>,
    ) {
      const { messageId, usage, genMs, reasoningMs, finishReason } = action.payload;
      messagesAdapter.updateOne(state.messages, {
        id: messageId,
        changes: {
          status: "complete",
          ...(usage ? { usage } : {}),
          ...(genMs !== undefined ? { genMs } : {}),
          ...(reasoningMs !== undefined ? { reasoningMs } : {}),
          ...(finishReason !== undefined ? { finishReason } : {}),
        },
      });
      // Deliberately does NOT clear streamingByConversation: the flag is
      // TURN-scoped (a turn can continue into tool execution and further
      // messages). Only endTurn clears it — see audit #12.
    },
    /** A whole turn (stream + tool loop) ended — clear the streaming flag.
     *  Dispatched from runTurn's finally so evictConversationMessages can never
     *  wipe a conversation while its tool loop is still writing (audit #12). */
    endTurn(state, action: PayloadAction<string>) {
      delete state.streamingByConversation[action.payload];
    },
    removeMessage(
      state,
      action: PayloadAction<{ conversationId: string; messageId: string }>,
    ) {
      const { conversationId, messageId } = action.payload;
      messagesAdapter.removeOne(state.messages, messageId);
      const index = state.messagesByConversation[conversationId];
      if (index) {
        state.messagesByConversation[conversationId] = index.filter(
          (id) => id !== messageId,
        );
      }
      // Drop artifacts derived from this message (id = `${messageId}#i`) so a
      // regenerate/removal doesn't leave orphans openable in the panel.
      const artIds = state.artifactIdsByConversation[conversationId];
      if (artIds) {
        const prefix = `${messageId}#`;
        for (const id of artIds) if (id.startsWith(prefix)) delete state.artifacts[id];
        state.artifactIdsByConversation[conversationId] = artIds.filter(
          (id) => !id.startsWith(prefix),
        );
      }
    },
    failAssistantMessage(
      state,
      action: PayloadAction<{
        conversationId: string;
        messageId: string;
        error: string;
      }>,
    ) {
      messagesAdapter.updateOne(state.messages, {
        id: action.payload.messageId,
        changes: { status: "error", error: action.payload.error },
      });
      // Turn-scoped: the flag survives until endTurn (see finishAssistantMessage).
    },

    addArtifact(state, action: PayloadAction<AIArtifact>) {
      const artifact = action.payload;
      state.artifacts[artifact.id] = artifact;
      const index = (state.artifactIdsByConversation[artifact.conversationId] ??= []);
      if (!index.includes(artifact.id)) index.push(artifact.id);
      const message = state.messages.entities[artifact.sourceMessageId];
      if (message && !(message.artifactIds ?? []).includes(artifact.id)) {
        message.artifactIds = [...(message.artifactIds ?? []), artifact.id];
      }
    },
    setOpenArtifact(
      state,
      action: PayloadAction<{ conversationId: string; artifactId: string | null }>,
    ) {
      state.openArtifactIdByConversation[action.payload.conversationId] =
        action.payload.artifactId;
    },

    setProviders(state, action: PayloadAction<AIProviderConfig[]>) {
      state.providers = {};
      for (const config of action.payload) state.providers[config.id] = config;
    },
    upsertProviderConfig(state, action: PayloadAction<AIProviderConfig>) {
      state.providers[action.payload.id] = action.payload;
    },
    removeProviderConfig(state, action: PayloadAction<string>) {
      delete state.providers[action.payload];
      delete state.providerStatus[action.payload];
    },
    setProviderStatus(
      state,
      action: PayloadAction<{ providerId: string; status: AIProviderStatus }>,
    ) {
      state.providerStatus[action.payload.providerId] = action.payload.status;
    },
    patchProviderStatus(
      state,
      action: PayloadAction<{
        providerId: string;
        patch: Partial<AIProviderStatus>;
      }>,
    ) {
      const current =
        state.providerStatus[action.payload.providerId] ??
        ({ status: "unknown", lastError: null } as AIProviderStatus);
      state.providerStatus[action.payload.providerId] = {
        ...current,
        ...action.payload.patch,
      };
    },
    setProviderModels(
      state,
      action: PayloadAction<{ providerId: string; models: AIModelInfo[] }>,
    ) {
      const current =
        state.providerStatus[action.payload.providerId] ??
        ({ status: "unknown", lastError: null } as AIProviderStatus);
      state.providerStatus[action.payload.providerId] = {
        ...current,
        models: action.payload.models,
      };
    },
    clearProviderStatus(state) {
      state.providerStatus = {};
    },

    setComposerDraft(
      state,
      action: PayloadAction<{ conversationId: string; draft: string }>,
    ) {
      if (action.payload.draft)
        state.composerDraftByConversation[action.payload.conversationId] =
          action.payload.draft;
      else delete state.composerDraftByConversation[action.payload.conversationId];
    },
    setPrefs(state, action: PayloadAction<AIPrefs>) {
      state.prefs = action.payload;
    },
    /** Stage (or clear) an "Ask AI" context to be sent with the next message. */
    setPendingContext(state, action: PayloadAction<AIContext | null>) {
      state.pendingContext = action.payload;
    },

    /** A model-proposed write awaiting the human approval gate. */
    addPendingWrite(state, action: PayloadAction<PendingWrite>) {
      const w = action.payload;
      // Refuse id reuse: an existing entry must never be overwritten (a colliding
      // call could replace a draft still awaiting approval, or flip a done write
      // back to re-approvable — audit #48). Ids are internal nanoids, so a
      // collision here is a caller bug, not a normal path.
      if (state.pendingWrites[w.id]) return;
      state.pendingWrites[w.id] = w;
      const index = (state.pendingWriteIdsByConversation[w.conversationId] ??= []);
      if (!index.includes(w.id)) index.push(w.id);
    },
    /** Replace all pending writes (login hydration from IndexedDB). */
    setPendingWrites(state, action: PayloadAction<PendingWrite[]>) {
      state.pendingWrites = {};
      state.pendingWriteIdsByConversation = {};
      for (const w of action.payload) {
        state.pendingWrites[w.id] = w;
        (state.pendingWriteIdsByConversation[w.conversationId] ??= []).push(w.id);
      }
    },
    updatePendingWrite(
      state,
      action: PayloadAction<{ id: string; changes: Partial<PendingWrite> }>,
    ) {
      const w = state.pendingWrites[action.payload.id];
      if (w) Object.assign(w, action.payload.changes);
    },
    removePendingWrite(state, action: PayloadAction<string>) {
      const w = state.pendingWrites[action.payload];
      if (!w) return;
      delete state.pendingWrites[action.payload];
      const index = state.pendingWriteIdsByConversation[w.conversationId];
      if (index) {
        state.pendingWriteIdsByConversation[w.conversationId] = index.filter(
          (id) => id !== action.payload,
        );
      }
    },
  },
});

export const {
  setConversations,
  upsertConversation,
  renameConversation,
  setConversationModel,
  removeConversation,
  setActiveConversation,
  setConversationMessages,
  evictConversationMessages,
  addMessage,
  startAssistantMessage,
  appendAssistantDelta,
  appendReasoningDelta,
  setMessageToolCalls,
  setToolResult,
  finishAssistantMessage,
  failAssistantMessage,
  endTurn,
  removeMessage,
  addArtifact,
  setOpenArtifact,
  setProviders,
  upsertProviderConfig,
  removeProviderConfig,
  setProviderStatus,
  patchProviderStatus,
  setProviderModels,
  clearProviderStatus,
  setComposerDraft,
  setPrefs,
  setPendingContext,
  addPendingWrite,
  setPendingWrites,
  updatePendingWrite,
  removePendingWrite,
} = aiSlice.actions;

// --- Selectors ---

/** Shared stable empty array — returning a fresh `[]` for empty lookups would
 *  break referential equality and re-render consumers on every dispatch. */
const EMPTY: readonly string[] = Object.freeze([]);

const conversationSelectors = conversationsAdapter.getSelectors(
  (state: RootState) => state.ai.conversations,
);
const messageSelectors = messagesAdapter.getSelectors(
  (state: RootState) => state.ai.messages,
);

export const selectConversationsSorted = conversationSelectors.selectAll;
export const selectConversationById = (id: string) => (state: RootState) =>
  conversationSelectors.selectById(state, id);
export const selectMessageById = (id: string) => (state: RootState) =>
  messageSelectors.selectById(state, id);

export const selectActiveConversationId = (state: RootState) =>
  state.ai.activeConversationId;

export const selectMessageIdsForConversation =
  (conversationId: string | null) =>
  (state: RootState): readonly string[] =>
    conversationId ? (state.ai.messagesByConversation[conversationId] ?? EMPTY) : EMPTY;

export const selectIsStreaming =
  (conversationId: string | null) => (state: RootState) =>
    conversationId ? !!state.ai.streamingByConversation[conversationId] : false;

// Memoized: a plain `Object.values(...)` returns a fresh array every call, so
// `useSelector` would never bail — re-rendering the always-mounted model picker
// on every streaming delta. createSelector keeps identity stable until the
// providers map actually changes.
export const selectProviderConfigs = createSelector(
  [(state: RootState) => state.ai.providers],
  (providers): AIProviderConfig[] => Object.values(providers),
);

export const selectProviderConfig =
  (providerId: string | null) =>
  (state: RootState): AIProviderConfig | undefined =>
    providerId ? state.ai.providers[providerId] : undefined;

export const selectProviderStatus =
  (providerId: string) =>
  (state: RootState): AIProviderStatus =>
    state.ai.providerStatus[providerId] ?? { status: "unknown", lastError: null };

export const selectArtifactById = (id: string) => (state: RootState) =>
  state.ai.artifacts[id];

export const selectArtifactIdsForConversation =
  (conversationId: string | null) =>
  (state: RootState): readonly string[] =>
    conversationId ? (state.ai.artifactIdsByConversation[conversationId] ?? EMPTY) : EMPTY;

export const selectOpenArtifactId =
  (conversationId: string | null) => (state: RootState) =>
    conversationId
      ? (state.ai.openArtifactIdByConversation[conversationId] ?? null)
      : null;

export const selectComposerDraft =
  (conversationId: string | null) => (state: RootState) =>
    conversationId
      ? (state.ai.composerDraftByConversation[conversationId] ?? "")
      : "";

export const selectAIPrefs = (state: RootState) => state.ai.prefs;

export const selectPendingContext = (state: RootState) =>
  state.ai.pendingContext;

export const selectPendingWriteById = (id: string) => (state: RootState) =>
  state.ai.pendingWrites[id];

export const selectPendingWriteIdsForConversation =
  (conversationId: string | null) =>
  (state: RootState): readonly string[] =>
    conversationId
      ? (state.ai.pendingWriteIdsByConversation[conversationId] ?? EMPTY)
      : EMPTY;

/** Count of writes still awaiting approval in a conversation (gate guardrail). */
export const selectOpenPendingWriteCount =
  (conversationId: string | null) => (state: RootState) =>
    conversationId
      ? (state.ai.pendingWriteIdsByConversation[conversationId] ?? []).filter(
          (id) => state.ai.pendingWrites[id]?.status === "pending",
        ).length
      : 0;

export const selectIsConversationHydrated =
  (conversationId: string | null) => (state: RootState) =>
    conversationId
      ? state.ai.hydratedConversations.includes(conversationId)
      : false;
