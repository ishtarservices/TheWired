import type { AIConversation, AIMessage } from "@/types/ai";
import { getDB, type TheWiredDB } from "./database";

/**
 * Per-account persistence for AI conversations + messages. Mirrors
 * `eventStore.ts` (tx-batched writes, index reads). Conversations live as long
 * as the account does; eviction from Redux is separate (IDB stays canonical).
 */

type StoredConversation = TheWiredDB["aiConversations"]["value"];
type StoredMessage = TheWiredDB["aiMessages"]["value"];

/**
 * Per-key write serializer. `putMessage`/`deleteMessage` for the SAME message id
 * are fired-and-forgotten from different code paths (stream finish vs. a
 * regenerate that deletes that message). Without ordering, a delete can land
 * before a still-pending put and resurrect (or lose) the row. Chaining ops per
 * key preserves call order; the chain entry is cleared once it drains.
 */
const writeChains = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, op: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const result = prev.then(op, op); // run op regardless of the previous outcome
  const settled = result.catch(() => {});
  writeChains.set(key, settled);
  void settled.then(() => {
    if (writeChains.get(key) === settled) writeChains.delete(key);
  });
  return result;
}

function stripConversation(stored: StoredConversation): AIConversation {
  const { _account, _cachedAt, ...conversation } = stored;
  void _account;
  void _cachedAt;
  return conversation;
}

function stripMessage(stored: StoredMessage): AIMessage {
  const { _account, _cachedAt, ...message } = stored;
  void _account;
  void _cachedAt;
  return message;
}

export async function putConversation(
  conversation: AIConversation,
  account: string,
): Promise<void> {
  const db = await getDB();
  await db.put("aiConversations", {
    ...conversation,
    _account: account,
    _cachedAt: Date.now(),
  });
}

export async function getConversationsForAccount(
  account: string,
): Promise<AIConversation[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(
    "aiConversations",
    "by_account",
    account,
  );
  return all
    .map(stripConversation)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteConversation(conversationId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["aiConversations", "aiMessages"], "readwrite");
  await tx.objectStore("aiConversations").delete(conversationId);
  // Cascade: remove every message belonging to this conversation.
  const messageStore = tx.objectStore("aiMessages");
  let cursor = await messageStore
    .index("by_conversation")
    .openCursor(conversationId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function putMessage(
  message: AIMessage,
  account: string,
): Promise<void> {
  await serialize(message.id, async () => {
    const db = await getDB();
    await db.put("aiMessages", {
      ...message,
      _account: account,
      _cachedAt: Date.now(),
    });
  });
}

export async function putMessages(
  messages: AIMessage[],
  account: string,
): Promise<void> {
  if (messages.length === 0) return;
  const db = await getDB();
  const now = Date.now();
  const tx = db.transaction("aiMessages", "readwrite");
  for (const message of messages) {
    tx.store.put({ ...message, _account: account, _cachedAt: now });
  }
  await tx.done;
}

export async function getMessagesForConversation(
  conversationId: string,
): Promise<AIMessage[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(
    "aiMessages",
    "by_conversation",
    conversationId,
  );
  return all.map(stripMessage).sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteMessage(messageId: string): Promise<void> {
  await serialize(messageId, async () => {
    const db = await getDB();
    await db.delete("aiMessages", messageId);
  });
}
