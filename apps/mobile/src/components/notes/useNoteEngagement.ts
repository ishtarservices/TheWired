// Per-card engagement counts + own-state flags — narrow scalar selectors so
// count churn re-renders only the (memo'd) footer leaf that calls this, never
// the card around it (desktop useNoteEngagement pattern).

import { useMemo } from "react";
import { shallowEqual } from "react-redux";

import { useAppSelector } from "@/store/hooks";
import {
  selectMyReaction,
  selectMyRepost,
  selectReactionCount,
  selectRepostCount,
} from "@/store/slices/engagementSlice";

export interface NoteEngagement {
  replyCount: number;
  reactionCount: number;
  repostCount: number;
  zapMsat: number;
  zapCount: number;
  liked: boolean;
  reposted: boolean;
}

export function useNoteEngagement(eventId: string): NoteEngagement {
  const myPubkey = useAppSelector((s) => s.identity.pubkey);

  const reactionCount = useAppSelector((s) => selectReactionCount(s, eventId));
  const myReaction = useAppSelector((s) => selectMyReaction(s, eventId, myPubkey));
  const repostCount = useAppSelector((s) => selectRepostCount(s, eventId));
  const reposted = useAppSelector((s) => selectMyRepost(s, eventId, myPubkey));
  const replyIds = useAppSelector((s) => s.engagement.repliesByTarget[eventId], shallowEqual);
  const zaps = useAppSelector((s) => s.zaps.byEvent[eventId], shallowEqual);

  const liked = myReaction !== undefined;
  const replyCount = replyIds?.length ?? 0;
  const zapMsat = zaps?.msat ?? 0;
  const zapCount = zaps?.count ?? 0;

  return useMemo(
    () => ({ replyCount, reactionCount, repostCount, zapMsat, zapCount, liked, reposted }),
    [replyCount, reactionCount, repostCount, zapMsat, zapCount, liked, reposted],
  );
}
