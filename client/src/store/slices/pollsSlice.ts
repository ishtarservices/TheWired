import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ParsedPoll } from "../../features/polls/pollParser";

/** A voter's current (latest) vote on a poll. NIP-88: one vote per pubkey —
 *  the event with the largest created_at wins. */
export interface PollVoteEntry {
  optionIds: string[];
  createdAt: number;
  eventId: string;
}

interface PollsState {
  /** pollId → voterPubkey → latest vote. Mirrors reactionsSlice: kind:1018
   *  events fold into this aggregate and are never stored in the entity
   *  adapter (~80 bytes/vote vs a full signed event). */
  byPoll: Record<string, Record<string, PollVoteEntry>>;
  /** voteEventId → location, so a kind:5 deletion (which references the vote
   *  by id) can find and remove it without us keeping the full event. */
  byEventId: Record<string, { pollId: string; voter: string }>;
}

const initialState: PollsState = { byPoll: {}, byEventId: {} };

export interface PollVoteInput {
  pollId: string;
  voter: string;
  optionIds: string[];
  createdAt: number;
  eventId: string;
}

function applyVote(state: PollsState, v: PollVoteInput): void {
  let poll = state.byPoll[v.pollId];
  if (!poll) {
    poll = {};
    state.byPoll[v.pollId] = poll;
  }
  const existing = poll[v.voter];
  if (existing) {
    // Latest created_at wins; equal timestamps tie-break on the lower event id
    // so every client converges on the same vote regardless of arrival order.
    const incomingWins =
      v.createdAt > existing.createdAt ||
      (v.createdAt === existing.createdAt && v.eventId < existing.eventId);
    if (!incomingWins) return;
    delete state.byEventId[existing.eventId];
  }
  poll[v.voter] = { optionIds: v.optionIds, createdAt: v.createdAt, eventId: v.eventId };
  state.byEventId[v.eventId] = { pollId: v.pollId, voter: v.voter };
}

export const pollsSlice = createSlice({
  name: "polls",
  initialState,
  reducers: {
    addPollVote(state, action: PayloadAction<PollVoteInput>) {
      applyVote(state, action.payload);
    },
    /** Batched variant used by the eventPipeline burst flush. */
    addPollVotes(state, action: PayloadAction<PollVoteInput[]>) {
      for (const v of action.payload) applyVote(state, v);
    },
    /** Remove a vote referenced by its kind:1018 event id (NIP-09 deletion).
     *  Only the original voter may delete their own vote. */
    removeVoteByEventId(
      state,
      action: PayloadAction<{ eventId: string; byPubkey: string }>,
    ) {
      const { eventId, byPubkey } = action.payload;
      const loc = state.byEventId[eventId];
      if (!loc) return;
      const entry = state.byPoll[loc.pollId]?.[loc.voter];
      if (!entry || entry.eventId !== eventId || loc.voter !== byPubkey) return;
      delete state.byPoll[loc.pollId][loc.voter];
      delete state.byEventId[eventId];
      if (Object.keys(state.byPoll[loc.pollId]).length === 0) {
        delete state.byPoll[loc.pollId];
      }
    },
    /** Drop a poll's whole aggregate (poll deleted). */
    removePoll(state, action: PayloadAction<string>) {
      const pollId = action.payload;
      const votes = state.byPoll[pollId];
      if (!votes) return;
      for (const voter of Object.keys(votes)) {
        delete state.byEventId[votes[voter].eventId];
      }
      delete state.byPoll[pollId];
    },
  },
});

export const { addPollVote, addPollVotes, removeVoteByEventId, removePoll } =
  pollsSlice.actions;

// --- Selectors (typed structurally to avoid a circular store import) ---
type WithPolls = { polls: PollsState };

/** The per-voter vote map for a poll (stable reference for memoization). */
export function selectPollVotes(
  state: WithPolls,
  pollId: string,
): Record<string, PollVoteEntry> | undefined {
  return state.polls.byPoll[pollId];
}

/** The current user's vote on a poll, else undefined. */
export function selectMyVote(
  state: WithPolls,
  pollId: string,
  myPubkey: string | null,
): PollVoteEntry | undefined {
  if (!myPubkey) return undefined;
  return state.polls.byPoll[pollId]?.[myPubkey];
}

export interface PollTally {
  byOption: Record<string, number>;
  /** Voter pubkeys per option, insertion-ordered, capped (for avatar stacks). */
  votersByOption: Record<string, string[]>;
  totalVoters: number;
  winnerOptionIds: string[];
  /** Voters dropped by the member filter (shown as "+k other votes"). */
  excludedNonMembers: number;
}

const VOTERS_PER_OPTION_CAP = 12;

/** Pure tally over a poll's vote map. Components memoize on the (stable) map
 *  reference. Enforces NIP-88 counting rules in one place:
 *  - votes after endsAt are ignored
 *  - singlechoice counts only the first optionId that exists in the poll
 *  - multiplechoice counts each known optionId once
 *  - a vote with no known optionIds doesn't count toward totalVoters
 *  - memberFilter (when given) drops non-member voters */
export function tallyPoll(
  votes: Record<string, PollVoteEntry> | undefined,
  poll: ParsedPoll,
  memberFilter?: Set<string>,
): PollTally {
  const byOption: Record<string, number> = {};
  const votersByOption: Record<string, string[]> = {};
  const knownIds = new Set(poll.options.map((o) => o.id));
  for (const option of poll.options) {
    byOption[option.id] = 0;
    votersByOption[option.id] = [];
  }

  let totalVoters = 0;
  let excludedNonMembers = 0;

  if (votes) {
    for (const voter of Object.keys(votes)) {
      const entry = votes[voter];
      if (poll.endsAt !== undefined && entry.createdAt > poll.endsAt) continue;
      const validIds =
        poll.pollType === "singlechoice"
          ? entry.optionIds.filter((id) => knownIds.has(id)).slice(0, 1)
          : entry.optionIds.filter((id) => knownIds.has(id));
      if (validIds.length === 0) continue;
      if (memberFilter && !memberFilter.has(voter)) {
        excludedNonMembers++;
        continue;
      }
      totalVoters++;
      for (const id of validIds) {
        byOption[id]++;
        if (votersByOption[id].length < VOTERS_PER_OPTION_CAP) {
          votersByOption[id].push(voter);
        }
      }
    }
  }

  let max = 0;
  for (const option of poll.options) {
    if (byOption[option.id] > max) max = byOption[option.id];
  }
  const winnerOptionIds =
    max > 0 ? poll.options.filter((o) => byOption[o.id] === max).map((o) => o.id) : [];

  return { byOption, votersByOption, totalVoters, winnerOptionIds, excludedNonMembers };
}
