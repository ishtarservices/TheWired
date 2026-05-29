import { useMemo } from "react";
import { shallowEqual } from "react-redux";
import { useAppSelector } from "../../store/hooks";
import { selectReactionCount, selectMyReaction } from "../../store/slices/reactionsSlice";

export interface NoteEngagement {
  replyCount: number;
  reactionCount: number;
  repostCount: number;
  quoteCount: number;
  liked: boolean;
  reposted: boolean;
}

/** Per-note engagement counts + whether current user has liked/reposted */
export function useNoteEngagement(eventId: string): NoteEngagement {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  // Reactions come from the aggregate slice (count + my-reaction), not the
  // entity store — no full kind:7 events are kept.
  const reactionCount = useAppSelector((s) => selectReactionCount(s, eventId));
  const myReaction = useAppSelector((s) => selectMyReaction(s, eventId, myPubkey));

  const replyIds = useAppSelector(
    (s) => s.events.replies[eventId],
    shallowEqual,
  );
  const repostIds = useAppSelector(
    (s) => s.events.reposts[eventId],
    shallowEqual,
  );
  const quoteIds = useAppSelector(
    (s) => s.events.quotes[eventId],
    shallowEqual,
  );

  // Only select the pubkeys we need for the reposted check, not all entities
  const reposted = useAppSelector((s) => {
    if (!myPubkey || !repostIds) return false;
    return repostIds.some((id) => s.events.entities[id]?.pubkey === myPubkey);
  });

  const liked = myReaction !== undefined;

  return useMemo(() => ({
    replyCount: replyIds?.length ?? 0,
    reactionCount,
    repostCount: repostIds?.length ?? 0,
    quoteCount: quoteIds?.length ?? 0,
    liked,
    reposted,
  }), [reactionCount, replyIds, repostIds, quoteIds, liked, reposted]);
}
