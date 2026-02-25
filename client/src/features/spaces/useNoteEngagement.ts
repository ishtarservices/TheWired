import { useMemo } from "react";
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
  const reactionIds = useAppSelector((s) => s.events.reactions[eventId]);
  const replyIds = useAppSelector((s) => s.events.replies[eventId]);
  const repostIds = useAppSelector((s) => s.events.reposts[eventId]);
  const quoteIds = useAppSelector((s) => s.events.quotes[eventId]);
  const entities = useAppSelector((s) => s.events.entities);

  return useMemo(() => {
    const reactions = reactionIds ?? [];
    const replies = replyIds ?? [];
    const reposts = repostIds ?? [];
    const quotes = quoteIds ?? [];

    let liked = false;
    let reposted = false;

    if (myPubkey) {
      liked = reactions.some((id) => {
        const ev = entities[id];
        return ev?.pubkey === myPubkey;
      });
      reposted = reposts.some((id) => {
        const ev = entities[id];
        return ev?.pubkey === myPubkey;
      });
    }

    return {
      replyCount: replies.length,
      reactionCount: reactions.length,
      repostCount: reposts.length,
      quoteCount: quotes.length,
      liked,
      reposted,
    };
  }, [myPubkey, reactionIds, replyIds, repostIds, quoteIds, entities]);
}
