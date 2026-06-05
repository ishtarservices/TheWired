/**
 * WRITE tools — the agent NEVER signs or publishes. Each run() builds an unsigned
 * draft, registers a PendingWrite (id = toolCallId, binding approval to this exact
 * call), and returns an "awaiting approval" tool result. The human gate
 * (PendingWriteCard) resolves relays/recipients and signs ONLY on Approve.
 * Targets are resolved against live app state, never trusted from the model.
 */
import { store } from "@/store";
import { addPendingWrite } from "@/store/slices/aiSlice";
import type { PendingWrite } from "@/types/ai";
import { displayName } from "../context/aiContext";
import type { ToolDef, ToolContext } from "./types";
import { asString, clampContent, clampTitle, resolveRecipient } from "./validate";

/** Max writes a single conversation may have awaiting approval at once. */
const MAX_OPEN_PENDING = 3;

function openPendingCount(conversationId: string): number {
  const ai = store.getState().ai;
  return (ai.pendingWriteIdsByConversation[conversationId] ?? []).filter(
    (id) => ai.pendingWrites[id]?.status === "pending",
  ).length;
}

function register(write: Omit<PendingWrite, "status" | "createdAt">): string {
  if (openPendingCount(write.conversationId) >= MAX_OPEN_PENDING) {
    throw new Error(
      "There are already several drafts waiting for the user's approval. Ask them to review those before drafting more.",
    );
  }
  store.dispatch(
    addPendingWrite({ ...write, status: "pending", createdAt: Date.now() }),
  );
  return write.id;
}

const PENDING_MSG = (what: string) =>
  `Drafted ${what}. It is shown to the user as an approval card and has NOT been sent — the user must approve it. Tell the user it's ready for review; do not claim it was posted.`;

const publish_note: ToolDef = {
  name: "publish_note",
  description:
    "Draft a public note (kind:1) for the user to review and approve before it is published. Does NOT post.",
  parameters: {
    type: "object",
    properties: { content: { type: "string", description: "note text" } },
    required: ["content"],
  },
  access: "write",
  run(args, ctx: ToolContext) {
    const content = clampContent(args.content);
    if (!content.trim()) return { output: "Error: empty note content." };
    const id = register({
      id: ctx.toolCallId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      kind: "note",
      summary: "Post a public note",
      content,
    });
    return { output: PENDING_MSG("a public note"), pendingWriteId: id };
  },
};

const reply_to: ToolDef = {
  name: "reply_to",
  description:
    "Draft a public reply (kind:1) to a note, by the target note's event id, for the user to approve. Does NOT post.",
  parameters: {
    type: "object",
    properties: {
      eventId: { type: "string", description: "event id of the note to reply to" },
      content: { type: "string" },
    },
    required: ["eventId", "content"],
  },
  access: "write",
  run(args, ctx) {
    const content = clampContent(args.content);
    const eventId = asString(args.eventId).trim();
    const target = store.getState().events.entities[eventId];
    if (!target) return { output: "Error: that note isn't loaded; can't reply." };
    if (!content.trim()) return { output: "Error: empty reply content." };
    const id = register({
      id: ctx.toolCallId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      kind: "reply",
      summary: `Reply to ${displayName(target.pubkey)}`,
      content,
      replyToEventId: eventId,
      replyToPubkey: target.pubkey,
    });
    return { output: PENDING_MSG("a reply"), pendingWriteId: id };
  },
};

const send_dm: ToolDef = {
  name: "send_dm",
  description:
    "Draft a direct message (NIP-17) to a recipient for the user to approve. Recipient is an npub/hex, or the display name of one of the user's existing contacts. Does NOT send.",
  parameters: {
    type: "object",
    properties: {
      recipient: { type: "string", description: "npub/hex or a known contact's name" },
      content: { type: "string" },
    },
    required: ["recipient", "content"],
  },
  access: "write",
  run(args, ctx) {
    const content = clampContent(args.content);
    if (!content.trim()) return { output: "Error: empty message content." };
    const recipient = resolveRecipient(args.recipient);
    if (!recipient)
      return {
        output:
          "Error: couldn't resolve that recipient. Provide an npub/hex pubkey, or the name of an existing contact.",
      };
    const id = register({
      id: ctx.toolCallId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      kind: "dm",
      summary: `DM ${recipient.label}`,
      content,
      recipientPubkey: recipient.pubkey,
      recipientLabel: recipient.label,
    });
    return { output: PENDING_MSG(`a DM to ${recipient.label}`), pendingWriteId: id };
  },
};

const post_to_space: ToolDef = {
  name: "post_to_space",
  description:
    "Draft a message to post in one of the user's spaces (by space id) for approval. Does NOT post.",
  parameters: {
    type: "object",
    properties: {
      spaceId: { type: "string" },
      content: { type: "string" },
    },
    required: ["spaceId", "content"],
  },
  access: "write",
  run(args, ctx) {
    const content = clampContent(args.content);
    const spaceId = asString(args.spaceId).trim();
    const state = store.getState();
    const space = state.spaces.list.find((s) => s.id === spaceId);
    if (!space) return { output: "Error: unknown space id." };
    if (space.mode !== "read-write")
      return { output: "Error: you can't post to that space (read-only)." };
    if (!content.trim()) return { output: "Error: empty message." };
    const chatChannel = (state.spaces.channels[spaceId] ?? []).find(
      (c) => c.type === "chat" && !c.adminOnly,
    );
    const id = register({
      id: ctx.toolCallId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      kind: "space_message",
      summary: `Post to ${space.name}`,
      content,
      spaceId,
      channelId: chatChannel?.id,
    });
    return { output: PENDING_MSG(`a message to ${space.name}`), pendingWriteId: id };
  },
};

const publish_article: ToolDef = {
  name: "publish_article",
  description:
    "Draft a long-form article (kind:30023) for the user to review and approve. Does NOT publish.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string", description: "Markdown body" },
    },
    required: ["title", "content"],
  },
  access: "write",
  run(args, ctx) {
    const title = clampTitle(args.title);
    const content = clampContent(args.content, 20000);
    if (!title || !content.trim()) return { output: "Error: article needs a title and body." };
    const id = register({
      id: ctx.toolCallId,
      conversationId: ctx.conversationId,
      messageId: ctx.messageId,
      kind: "article",
      summary: `Publish article: ${title}`,
      title,
      content,
    });
    return { output: PENDING_MSG(`an article "${title}"`), pendingWriteId: id };
  },
};

export const WRITE_TOOLS: ToolDef[] = [
  publish_note,
  reply_to,
  send_dm,
  post_to_space,
  publish_article,
];
