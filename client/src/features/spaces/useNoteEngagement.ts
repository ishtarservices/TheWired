import { useMemo } from "react";
import { shallowEqual } from "react-redux";
import { useAppSelector } from "../../store/hooks";

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

  const reactionIds = useAppSelector(
    (s) => s.events.reactions[eventId],
    shallowEqual,
  );
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

  // Only select the pubkeys we need for liked/reposted checks, not all entities
  const liked = useAppSelector((s) => {
    if (!myPubkey || !reactionIds) return false;
    return reactionIds.some((id) => s.events.entities[id]?.pubkey === myPubkey);
  });

  const reposted = useAppSelector((s) => {
    if (!myPubkey || !repostIds) return false;
    return repostIds.some((id) => s.events.entities[id]?.pubkey === myPubkey);
  });

  return useMemo(() => ({
    replyCount: replyIds?.length ?? 0,
    reactionCount: reactionIds?.length ?? 0,
    repostCount: repostIds?.length ?? 0,
    quoteCount: quoteIds?.length ?? 0,
    liked,
    reposted,
  }), [reactionIds, replyIds, repostIds, quoteIds, liked, reposted]);
}
