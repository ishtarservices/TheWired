/**
 * The agentic backstop: a PendingWrite is signed + published ONLY here, only on
 * explicit human Approve, and only with the (possibly edited) fields shown on the
 * card. Relays/recipients are resolved app-side from the PendingWrite — the model
 * never chose them. Mirrors the music feature's publish seams. (agentic-safety
 * research: human-in-the-loop is the real mitigation; no optimistic publish.)
 */
import { store } from "@/store";
import { updatePendingWrite } from "@/store/slices/aiSlice";
import { putPendingWrite } from "@/lib/db/aiPendingWriteStore";
import {
  buildRootNote,
  buildReply,
  buildChatMessage,
  buildArticle,
} from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { sendDM } from "@/features/dm/dmService";
import type { PendingWrite } from "@/types/ai";
import type { UnsignedEvent } from "@/types/nostr";

export interface ApproveEdits {
  content?: string;
  title?: string;
}

function writeRelayCount(): number {
  return relayManager.getWriteRelays().length;
}

/** Write the live entry through to IndexedDB after a status change, so the
 *  card's state survives a reload (audit #98). */
function persistWrite(id: string): void {
  const state = store.getState();
  const write = state.ai.pendingWrites[id];
  const account = state.identity.pubkey;
  if (write && account) void putPendingWrite(write, account);
}

export function cancelPendingWrite(id: string): void {
  store.dispatch(updatePendingWrite({ id, changes: { status: "cancelled" } }));
  persistWrite(id);
}

export async function approvePendingWrite(
  write: PendingWrite,
  edits?: ApproveEdits,
): Promise<void> {
  // Signing is irreversible: read the LIVE status and bail unless it's still
  // awaiting approval, so a double-fire / re-render race can't re-publish. The
  // "publishing" dispatch below runs synchronously before the first await and
  // acts as the lock for any concurrent caller. (Defense-in-depth at the actual
  // signing boundary, not just the button's disabled state.)
  const live = store.getState().ai.pendingWrites[write.id];
  if (!live || (live.status !== "pending" && live.status !== "error")) return;

  const content = (edits?.content ?? write.content).trim();
  const title = (edits?.title ?? write.title)?.trim();
  if (!content) {
    store.dispatch(updatePendingWrite({ id: write.id, changes: { status: "error", error: "Empty content." } }));
    persistWrite(write.id);
    return;
  }
  const pubkey = store.getState().identity.pubkey;
  if (!pubkey) {
    store.dispatch(updatePendingWrite({ id: write.id, changes: { status: "error", error: "Not logged in." } }));
    return;
  }

  store.dispatch(
    updatePendingWrite({ id: write.id, changes: { status: "publishing", content, title, error: undefined } }),
  );
  persistWrite(write.id);

  try {
    let result: string;
    switch (write.kind) {
      case "note": {
        await signAndPublish(buildRootNote(pubkey, content));
        result = `Published to ${writeRelayCount()} relays`;
        break;
      }
      case "reply": {
        if (!write.replyToEventId || !write.replyToPubkey) throw new Error("Missing reply target.");
        await signAndPublish(
          buildReply(pubkey, content, {
            eventId: write.replyToEventId,
            pubkey: write.replyToPubkey,
          }),
        );
        result = `Reply published to ${writeRelayCount()} relays`;
        break;
      }
      case "article": {
        await signAndPublish(buildArticle(pubkey, { content, title: title || "Untitled" }));
        result = `Article published to ${writeRelayCount()} relays`;
        break;
      }
      case "dm": {
        if (!write.recipientPubkey) throw new Error("Missing recipient.");
        await sendDM(write.recipientPubkey, content);
        result = `DM sent to ${write.recipientLabel ?? "recipient"}`;
        break;
      }
      case "space_message": {
        const space = store.getState().spaces.list.find((s) => s.id === write.spaceId);
        if (!space) throw new Error("Space not found.");
        relayManager.connect(space.hostRelay, "read+write");
        try {
          await relayManager.waitForConnection(space.hostRelay, 5000);
        } catch {
          /* publish anyway */
        }
        const channel = (store.getState().spaces.channels[space.id] ?? []).find(
          (c) => c.id === write.channelId,
        );
        const unsigned: UnsignedEvent =
          channel?.type === "chat" || !channel
            ? buildChatMessage(pubkey, space.id, content, undefined, write.channelId)
            : {
                pubkey,
                created_at: Math.floor(Date.now() / 1000),
                kind: 1,
                tags: [],
                content,
              };
        await signAndPublish(unsigned, [space.hostRelay]);
        result = `Posted to ${space.name}`;
        break;
      }
      default:
        throw new Error("Unknown write kind.");
    }
    store.dispatch(updatePendingWrite({ id: write.id, changes: { status: "done", result } }));
  } catch (e) {
    store.dispatch(
      updatePendingWrite({
        id: write.id,
        changes: { status: "error", error: e instanceof Error ? e.message : "Failed to publish" },
      }),
    );
  } finally {
    persistWrite(write.id);
  }
}
