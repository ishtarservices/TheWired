/**
 * The single publish path for kind:7 reactions and their kind:5 retractions.
 *
 * Used by the chat reaction picker, chat reaction pills, and the notes like
 * button so every surface follows the same wire contract (shared with mobile):
 *
 *  - react   → kind:7 `["e", target] ["p", author] ["k", kind]`, content emoji
 *              ("" ⇒ "+"), plus `["h", spaceId]` when the target is a chat
 *              message, published to the space's relay set.
 *  - un-react → kind:5 `["e", reactionId] ["k", "7"]` (+ `["h", spaceId]` for
 *              chat) — the reaction event id, never the target message.
 *
 * `signAndPublish` runs the signed event through the local pipeline pass, so
 * the store reflects the change as soon as signing completes. The optimistic
 * remove below only covers signer latency (NIP-46 bunkers) and is rolled back
 * if signing/publishing throws.
 */
import { store } from "@/store";
import type { Space } from "@/types/space";
import { EVENT_KINDS } from "@/types/nostr";
import { buildReaction, buildReactionDeletion } from "@/lib/nostr/eventBuilder";
import { signAndPublish } from "@/lib/nostr/publish";
import { relayManager } from "@/lib/nostr/relayManager";
import { resolveRelaySet } from "@/features/spaces/relaySet";
import {
  addReaction,
  removeReactionByEventId,
  selectMyReactionEventIds,
} from "@/store/slices/reactionsSlice";

export interface ReactionTarget {
  eventId: string;
  pubkey: string;
  kind: number;
}

/** The slice of a Space the publish path needs; `null`/`undefined` = no space
 *  context (Friends feed, profile pages) → user's write relays. */
export type ReactionSpaceContext =
  | Pick<Space, "id" | "mode" | "hostRelay" | "relayUrls">
  | null
  | undefined;

interface BaseArgs {
  myPubkey: string;
  target: ReactionTarget;
  space?: ReactionSpaceContext;
}

/** Chat reactions (target kind:9) are scoped to the space with an `h` tag. */
export function reactionSpaceId(
  target: ReactionTarget,
  space: ReactionSpaceContext,
): string | undefined {
  return target.kind === EVENT_KINDS.CHAT_MESSAGE && space ? space.id : undefined;
}

/**
 * Where a reaction (or its retraction) is published.
 *  - Chat targets: the space's full relay set (authority + mirrors), exactly
 *    where the chat message itself was sent (`useChat`).
 *  - Everything else: the `useNoteActions` rule — member interactions in a
 *    read-write space go to its host relay; feed/read-only/no-space
 *    interactions broadcast to the user's write relays (`undefined`).
 */
export function reactionRelayTargets(
  target: ReactionTarget,
  space: ReactionSpaceContext,
): string[] | undefined {
  if (!space || space.mode !== "read-write" || !space.hostRelay) return undefined;
  if (target.kind === EVENT_KINDS.CHAT_MESSAGE) {
    const set = resolveRelaySet(space);
    return set.length > 0 ? set : [space.hostRelay];
  }
  return [space.hostRelay];
}

/** `relayManager.publish` silently drops targets that aren't in the connection
 *  pool — make sure every target is dialed first (idempotent), as useChat does. */
async function publishTo(
  unsigned: Parameters<typeof signAndPublish>[0],
  targets: string[] | undefined,
) {
  for (const url of targets ?? []) relayManager.connect(url, "read+write");
  return signAndPublish(unsigned, targets);
}

/** Publish a new kind:7 on the target. Does not check for an existing one —
 *  callers wanting toggle semantics use `toggleReaction`. */
export async function publishReaction({
  myPubkey,
  target,
  content,
  emojiTag,
  space,
}: BaseArgs & { content: string; emojiTag?: string[] }): Promise<void> {
  const unsigned = buildReaction(
    myPubkey,
    target,
    content,
    emojiTag,
    reactionSpaceId(target, space),
  );
  await publishTo(unsigned, reactionRelayTargets(target, space));
}

/** Retract our own reactions by id: one kind:5 per reaction (the contract's
 *  single-`e` shape), optimistic removal with rollback on failure. */
export async function retractReactions({
  myPubkey,
  target,
  reactionEventIds,
  space,
}: BaseArgs & { reactionEventIds: string[] }): Promise<void> {
  const spaceId = reactionSpaceId(target, space);
  const targets = reactionRelayTargets(target, space);
  for (const reactionEventId of reactionEventIds) {
    const entry = store.getState().reactions.byTarget[target.eventId]?.[reactionEventId];
    if (!entry || entry.reactor !== myPubkey) continue; // not ours (or already gone)
    store.dispatch(removeReactionByEventId({ eventId: reactionEventId, byPubkey: myPubkey }));
    try {
      await publishTo(buildReactionDeletion(myPubkey, reactionEventId, spaceId), targets);
    } catch (err) {
      // Roll the optimistic removal back so the UI doesn't lie about state.
      store.dispatch(
        addReaction({
          targetEventId: target.eventId,
          reactor: myPubkey,
          content: entry.content,
          eventId: reactionEventId,
        }),
      );
      throw err;
    }
  }
}

/**
 * Toggle a specific emoji on a target: if we already reacted with it, retract
 * that reaction (kind:5); otherwise publish it (kind:7). A *different* emoji
 * simply adds — chat deliberately allows several reactions per user.
 */
export async function toggleReaction({
  myPubkey,
  target,
  content,
  emojiTag,
  space,
}: BaseArgs & { content: string; emojiTag?: string[] }): Promise<"added" | "removed"> {
  const normalized = content || "+";
  const mine = selectMyReactionEventIds(store.getState(), target.eventId, myPubkey, normalized);
  if (mine.length > 0) {
    await retractReactions({ myPubkey, target, reactionEventIds: mine, space });
    return "removed";
  }
  await publishReaction({ myPubkey, target, content: normalized, emojiTag, space });
  return "added";
}

/**
 * The notes "like" toggle: liked = any own reaction on the note. Unliking
 * retracts every own reaction (usually one — more only from the old
 * duplicate-like bug or another device), liking publishes a `+`.
 */
export async function toggleLike({
  myPubkey,
  target,
  space,
}: BaseArgs): Promise<"added" | "removed"> {
  const mine = selectMyReactionEventIds(store.getState(), target.eventId, myPubkey);
  if (mine.length > 0) {
    await retractReactions({ myPubkey, target, reactionEventIds: mine, space });
    return "removed";
  }
  await publishReaction({ myPubkey, target, content: "+", space });
  return "added";
}
