import { buildRumor, createGiftWrappedDM, createSelfWrap, type UnwrappedDM } from "./giftWrap";
import type { NostrEvent } from "@/types/nostr";

/**
 * NIP-17 group rooms (Decentralized Spaces, M8) — end-to-end-encrypted group
 * chat built on the existing 1:1 gift-wrap stack (`giftWrap.ts`).
 *
 * A group message is a single kind:14 rumor whose `p` tags list every recipient
 * (the sender is `rumor.pubkey`). It is then gift-wrapped (NIP-59, kind:1059)
 * once **per participant including the sender** — each wrap is an independent
 * NIP-44 encryption to that participant. The relay needs no changes: it stores
 * and routes kind:1059 by its `p` tag like any other gift wrap, and gift wraps
 * bypass NIP-29 membership gating.
 *
 * Trade-offs vs NIP-29 native groups: E2E-encrypted (the relay can't read or
 * moderate), but O(N) wraps per message and no relay-enforced membership — best
 * for small private rooms. This coexists with NIP-29 spaces, it doesn't replace
 * them.
 *
 * Room identity: an explicit, stable `roomId` (carried in a `g` tag) for named
 * persistent rooms, or — for ad-hoc rooms — derived from the participant set so
 * every member computes the same key.
 */

export interface GroupWrap {
  /** The participant this wrap is addressed/encrypted to. */
  to: string;
  wrap: NostrEvent;
}

export interface GroupMessageResult {
  /** Shared rumor id across all wraps (for edits/deletes/dedup). */
  rumorId: string;
  /** Stable room identifier (explicit `g` tag or participant-derived). */
  roomId: string;
  /** One gift wrap per participant (recipients + self). */
  wraps: GroupWrap[];
}

/** Stable key for an ad-hoc room: the sorted, de-duplicated participant set. */
export function roomKeyFromParticipants(pubkeys: string[]): string {
  return Array.from(new Set(pubkeys)).sort().join(",");
}

/**
 * Build the shared kind:14 group rumor (unsigned). `p`-tags every participant
 * except the sender; optionally carries a `subject` (room name) and a `g`
 * (explicit room id).
 */
export async function buildGroupRumor(
  myPubkey: string,
  participants: string[],
  content: string,
  opts?: { subject?: string; roomId?: string },
): Promise<Awaited<ReturnType<typeof buildRumor>>> {
  const others = Array.from(new Set(participants)).filter((p) => p && p !== myPubkey);
  if (others.length === 0) {
    throw new Error("a group rumor needs at least one other participant");
  }
  const extraTags: string[][] = others.slice(1).map((p) => ["p", p]);
  if (opts?.roomId) extraTags.push(["g", opts.roomId]);
  if (opts?.subject) extraTags.push(["subject", opts.subject]);
  // buildRumor prepends ["p", others[0]], so the rumor ends up p-tagging all
  // `others` plus the subject/g tags.
  return buildRumor(myPubkey, others[0], content, extraTags);
}

/**
 * Create the full set of gift wraps for one group message: one wrap per
 * recipient plus a self-wrap, all sealing the SAME rumor. The caller publishes
 * each wrap to that participant's DM inbox relays.
 */
export async function createGroupMessageWraps(
  content: string,
  participants: string[],
  myPubkey: string,
  opts?: { subject?: string; roomId?: string },
): Promise<GroupMessageResult> {
  const members = Array.from(new Set(participants));
  const others = members.filter((p) => p && p !== myPubkey);
  if (others.length === 0) {
    throw new Error("a group message needs at least one other participant");
  }

  const roomId = opts?.roomId ?? roomKeyFromParticipants(members);
  const rumor = await buildGroupRumor(myPubkey, members, content, {
    subject: opts?.subject,
    roomId: opts?.roomId,
  });

  const wraps: GroupWrap[] = [];
  for (const recipient of others) {
    const { wrap } = await createGiftWrappedDM(content, recipient, undefined, rumor);
    wraps.push({ to: recipient, wrap });
  }
  // Self-wrap so the sender sees their own message.
  const self = await createSelfWrap(content, myPubkey, undefined, rumor);
  wraps.push({ to: myPubkey, wrap: self.wrap });

  return { rumorId: rumor.id, roomId, wraps };
}

type RumorView = Pick<UnwrappedDM, "sender" | "tags">;

/** Full participant set of a received message: sender ∪ its `p` tags. */
export function participantsOf(unwrapped: RumorView): string[] {
  const ps = unwrapped.tags
    .filter((t) => t[0] === "p" && t[1])
    .map((t) => t[1]);
  return Array.from(new Set([unwrapped.sender, ...ps]));
}

/** A message is a group message when it has 3+ distinct participants. */
export function isGroupDM(unwrapped: RumorView): boolean {
  return participantsOf(unwrapped).length >= 3;
}

/** Resolve the room id of a received message (explicit `g` tag or derived). */
export function roomIdOf(unwrapped: RumorView): string {
  const g = unwrapped.tags.find((t) => t[0] === "g")?.[1];
  return g || roomKeyFromParticipants(participantsOf(unwrapped));
}

/** The room's subject/name, if any. */
export function subjectOf(unwrapped: RumorView): string | undefined {
  return unwrapped.tags.find((t) => t[0] === "subject")?.[1];
}
