import { useCallback, useMemo, useState } from "react";
import { useAppSelector } from "../../store/hooks";
import { selectMyVote, type PollVoteEntry } from "../../store/slices/pollsSlice";
import { buildPollVote } from "../../lib/nostr/eventBuilder";
import { signAndPublish } from "../../lib/nostr/publish";
import { relayManager } from "../../lib/nostr/relayManager";
import { resolveRelaySet } from "../spaces/relaySet";
import { isSafeRelayUrl } from "../../lib/security/ssrfGuard";
import type { ParsedPoll } from "./pollParser";

/**
 * Relay targets for a poll's votes: a space poll uses the space's relay set
 * (authority + mirrors); otherwise the poll's own relay tags — untrusted
 * event data, SSRF-screened before dialing. Empty result = caller falls back
 * to the user's default relays.
 */
export function usePollRelays(poll: ParsedPoll): string[] {
  const space = useAppSelector((s) =>
    poll.spaceId ? s.spaces.list.find((sp) => sp.id === poll.spaceId) : undefined,
  );

  return useMemo(() => {
    if (space?.hostRelay) {
      return resolveRelaySet({
        hostRelay: space.hostRelay,
        relayUrls: space.relayUrls ?? [],
      });
    }
    return poll.relays.filter((u) => {
      try {
        return isSafeRelayUrl(u);
      } catch {
        return false;
      }
    });
  }, [space?.hostRelay, space?.relayUrls, poll.relays]);
}

/**
 * Voting on a NIP-88 poll. `castVote` publishes a kind:1018 replacement vote
 * (latest created_at per pubkey wins, so change-vote is just re-casting).
 *
 * Optimistic UI comes from `signAndPublish`'s local pipeline pass (the 1018
 * case folds into the polls aggregate) — no hand-dispatch, no rollback: until
 * signing succeeds nothing was applied.
 */
export function useVote(poll: ParsedPoll): {
  myVote: PollVoteEntry | undefined;
  castVote: (optionIds: string[]) => Promise<void>;
  isVoting: boolean;
  canVote: boolean;
} {
  const pubkey = useAppSelector((s) => s.identity.pubkey);
  const myVote = useAppSelector((s) => selectMyVote(s, poll.id, pubkey));
  const relayTargets = usePollRelays(poll);
  const [isVoting, setIsVoting] = useState(false);

  const ended = poll.endsAt !== undefined && Math.floor(Date.now() / 1000) > poll.endsAt;
  const canVote = !!pubkey && !ended;

  const castVote = useCallback(
    async (optionIds: string[]) => {
      if (!pubkey || optionIds.length === 0 || isVoting) return;
      if (poll.endsAt !== undefined && Math.floor(Date.now() / 1000) > poll.endsAt) return;

      setIsVoting(true);
      try {
        const unsigned = buildPollVote(pubkey, poll.id, optionIds, {
          spaceId: poll.spaceId,
        });
        // relayManager.publish silently drops targets that aren't connected
        for (const url of relayTargets) {
          relayManager.connect(url, "read+write");
        }
        await signAndPublish(
          unsigned,
          relayTargets.length ? relayTargets : undefined,
        );
      } finally {
        setIsVoting(false);
      }
    },
    [pubkey, poll.id, poll.spaceId, poll.endsAt, relayTargets, isVoting],
  );

  return { myVote, castVote, isVoting, canVote };
}
