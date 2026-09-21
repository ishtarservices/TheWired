import type { Kind0Profile } from "@/types/profile";
import type { DMMessage } from "@/store/slices/dmSlice";
import type { ReactionPill } from "@/store/slices/reactionsSlice";

/** Derive a display name from a profile, falling back to a truncated pubkey */
export function getDisplayName(
  profile: Kind0Profile | null | undefined,
  pubkey: string,
): string {
  return (
    profile?.display_name || profile?.name || pubkey.slice(0, 8) + "..."
  );
}

/** Truncate a string for message preview display */
export function truncatePreview(text: string, max = 50): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

/**
 * Resolve a reply anchor (the rumor's `q` value) to the message it points at.
 * Current clients quote the target's rumorId — the one id both parties share —
 * so that is checked first; older clients quoted their own gift-wrap id, which
 * only resolves on the replier's side, so wrapId is the fallback.
 */
export function resolveDMReplyTarget(
  messages: readonly DMMessage[] | undefined,
  q: string | undefined,
): DMMessage | undefined {
  if (!messages || !q) return undefined;
  return messages.find((m) => m.rumorId === q) ?? messages.find((m) => m.wrapId === q);
}

/** Shape a DM's `reactions` map (emoji → reactor pubkeys) into the pill row
 *  shared with chat, flagging the ones the current user set. */
export function dmReactionPills(
  reactions: Record<string, string[]> | undefined,
  myPubkey: string | null,
): ReactionPill[] {
  if (!reactions) return [];
  return Object.entries(reactions)
    .filter(([, reactors]) => reactors.length > 0)
    .map(([content, reactors]) => ({
      content,
      count: reactors.length,
      mine: !!myPubkey && reactors.includes(myPubkey),
    }));
}
