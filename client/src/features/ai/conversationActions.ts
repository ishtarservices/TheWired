/**
 * Imperative conversation actions shared by the chat UI. Mirrors the
 * walletManager style: dispatches to Redux + writes through to IndexedDB, with
 * id/timestamp generation kept out of reducers. Streaming is delegated to
 * `streamRunner`.
 */
import { nanoid } from "nanoid";
import { store } from "@/store";
import {
  upsertConversation,
  setActiveConversation,
  addMessage,
  removeConversation,
  renameConversation,
  setConversations,
  setConversationMessages,
  setConversationModel,
  removeMessage,
} from "@/store/slices/aiSlice";
import {
  putConversation,
  putMessage,
  deleteConversation as dbDeleteConversation,
  deleteMessage as dbDeleteMessage,
  getConversationsForAccount,
  getMessagesForConversation,
} from "@/lib/db/aiConversationStore";
import type { AIContext, AIConversation, AIMessage } from "@/types/ai";
import { runTurn } from "./engine/streamRunner";
import { syncArtifactsForMessage } from "./artifacts/artifactSync";

function account(): string | null {
  return store.getState().identity.pubkey;
}

/** Load all conversations for an account into Redux (on login). */
export async function loadConversationsForAccount(pubkey: string): Promise<void> {
  const conversations = await getConversationsForAccount(pubkey);
  store.dispatch(setConversations(conversations));
}

/** Lazy-load a conversation's persisted messages (read-first on open). Artifacts
 *  are re-derived from message text (deterministic ids) so they survive reload. */
export async function hydrateConversation(conversationId: string): Promise<void> {
  if (store.getState().ai.hydratedConversations.includes(conversationId)) return;
  // A message persisted as "streaming" is a checkpoint from a generation that
  // was interrupted by a reload/crash — no stream is running now, so surface its
  // partial text as a normal (complete) bubble rather than a stuck spinner.
  const messages = (await getMessagesForConversation(conversationId)).map((m) =>
    m.status === "streaming" ? { ...m, status: "complete" as const } : m,
  );
  store.dispatch(setConversationMessages({ conversationId, messages }));
  for (const message of messages) {
    if (message.role === "assistant") syncArtifactsForMessage(message);
  }
}

/** Create a new empty conversation and make it active. Returns its id. */
export function createConversation(): string {
  const now = Date.now();
  const conversation: AIConversation = {
    id: nanoid(),
    title: "New chat",
    providerId: null,
    model: null,
    createdAt: now,
    updatedAt: now,
  };
  store.dispatch(upsertConversation(conversation));
  store.dispatch(setActiveConversation(conversation.id));
  store.dispatch(
    setConversationMessages({ conversationId: conversation.id, messages: [] }),
  );
  const acc = account();
  if (acc) void putConversation(conversation, acc);
  return conversation.id;
}

/** Add a user message and run the assistant turn. An optional "Ask AI" context
 *  is attached to the message — shown as a chip and framed as untrusted data
 *  when the turn is sent to the model. */
export async function sendUserMessage(
  conversationId: string,
  text: string,
  context?: AIContext,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const acc = account();
  const now = Date.now();

  const message: AIMessage = {
    id: nanoid(),
    conversationId,
    role: "user",
    parts: [{ type: "text", text: trimmed }],
    status: "complete",
    createdAt: now,
    ...(context ? { context } : {}),
  };
  store.dispatch(addMessage({ message, bumpUpdatedAt: now }));
  if (acc) void putMessage(message, acc);

  // Auto-title from the first user message.
  const convo = store.getState().ai.conversations.entities[conversationId];
  if (convo && (!convo.title || convo.title === "New chat")) {
    const title = trimmed.replace(/\s+/g, " ").slice(0, 60);
    store.dispatch(renameConversation({ id: conversationId, title, updatedAt: now }));
    const updated = store.getState().ai.conversations.entities[conversationId];
    if (acc && updated) void putConversation(updated, acc);
  }

  await runTurn(conversationId);
}

/** Set the provider + model for a conversation and persist it. */
export function setConversationModelEverywhere(
  conversationId: string,
  providerId: string,
  model: string,
): void {
  store.dispatch(setConversationModel({ conversationId, providerId, model }));
  const acc = account();
  const updated = store.getState().ai.conversations.entities[conversationId];
  if (acc && updated) void putConversation(updated, acc);
}

export async function deleteConversationEverywhere(id: string): Promise<void> {
  store.dispatch(removeConversation(id));
  await dbDeleteConversation(id);
}

/** Drop the last assistant message and re-run the turn. */
export async function regenerateLastTurn(conversationId: string): Promise<void> {
  const state = store.getState();
  const ids = state.ai.messagesByConversation[conversationId] ?? [];
  if (ids.length === 0) return;
  const lastId = ids[ids.length - 1];
  const last = state.ai.messages.entities[lastId];
  if (last?.role === "assistant") {
    store.dispatch(removeMessage({ conversationId, messageId: lastId }));
    void dbDeleteMessage(lastId);
  }
  await runTurn(conversationId);
}

export async function renameConversationEverywhere(
  id: string,
  title: string,
): Promise<void> {
  const now = Date.now();
  store.dispatch(renameConversation({ id, title: title.slice(0, 80), updatedAt: now }));
  const acc = account();
  const updated = store.getState().ai.conversations.entities[id];
  if (acc && updated) void putConversation(updated, acc);
}
