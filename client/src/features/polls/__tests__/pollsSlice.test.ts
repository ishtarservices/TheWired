import { describe, it, expect } from "vitest";
import {
  pollsSlice,
  addPollVote,
  addPollVotes,
  removeVoteByEventId,
  removePoll,
  tallyPoll,
  type PollVoteInput,
} from "../../../store/slices/pollsSlice";
import type { ParsedPoll } from "../pollParser";

const reducer = pollsSlice.reducer;

function vote(over: Partial<PollVoteInput> = {}): PollVoteInput {
  return {
    pollId: "poll-1",
    voter: "voter-a",
    optionIds: ["opt1"],
    createdAt: 100,
    eventId: "vote-1",
    ...over,
  };
}

function makePoll(over: Partial<ParsedPoll> = {}): ParsedPoll {
  return {
    id: "poll-1",
    pubkey: "author",
    createdAt: 50,
    question: "Q?",
    options: [
      { id: "opt1", label: "One" },
      { id: "opt2", label: "Two" },
    ],
    pollType: "singlechoice",
    relays: [],
    ...over,
  };
}

describe("pollsSlice — latest-wins vote aggregation", () => {
  it("stores one vote per voter", () => {
    let state = reducer(undefined, addPollVote(vote()));
    state = reducer(state, addPollVote(vote({ voter: "voter-b", eventId: "vote-2" })));
    expect(Object.keys(state.byPoll["poll-1"])).toHaveLength(2);
  });

  it("newer created_at replaces an older vote and cleans the reverse index", () => {
    let state = reducer(undefined, addPollVote(vote()));
    state = reducer(
      state,
      addPollVote(vote({ optionIds: ["opt2"], createdAt: 200, eventId: "vote-2" })),
    );
    expect(state.byPoll["poll-1"]["voter-a"].optionIds).toEqual(["opt2"]);
    expect(state.byEventId["vote-1"]).toBeUndefined();
    expect(state.byEventId["vote-2"]).toEqual({ pollId: "poll-1", voter: "voter-a" });
  });

  it("older created_at does not replace a newer vote", () => {
    let state = reducer(undefined, addPollVote(vote({ createdAt: 200 })));
    state = reducer(
      state,
      addPollVote(vote({ optionIds: ["opt2"], createdAt: 100, eventId: "vote-0" })),
    );
    expect(state.byPoll["poll-1"]["voter-a"].optionIds).toEqual(["opt1"]);
  });

  it("equal created_at tie-breaks deterministically on lower event id", () => {
    // Apply in both orders — result must converge
    let a = reducer(undefined, addPollVote(vote({ eventId: "vote-b" })));
    a = reducer(a, addPollVote(vote({ optionIds: ["opt2"], eventId: "vote-a" })));

    let b = reducer(undefined, addPollVote(vote({ optionIds: ["opt2"], eventId: "vote-a" })));
    b = reducer(b, addPollVote(vote({ eventId: "vote-b" })));

    expect(a.byPoll["poll-1"]["voter-a"].eventId).toBe("vote-a");
    expect(b.byPoll["poll-1"]["voter-a"].eventId).toBe("vote-a");
  });

  it("batched addPollVotes applies in order", () => {
    const state = reducer(
      undefined,
      addPollVotes([
        vote(),
        vote({ voter: "voter-b", eventId: "vote-2", optionIds: ["opt2"] }),
        vote({ createdAt: 300, eventId: "vote-3", optionIds: ["opt2"] }),
      ]),
    );
    expect(state.byPoll["poll-1"]["voter-a"].eventId).toBe("vote-3");
    expect(state.byPoll["poll-1"]["voter-b"].eventId).toBe("vote-2");
  });
});

describe("pollsSlice — deletions", () => {
  it("removes a vote only when the deleter is the voter", () => {
    let state = reducer(undefined, addPollVote(vote()));

    // Wrong author → no-op
    state = reducer(state, removeVoteByEventId({ eventId: "vote-1", byPubkey: "mallory" }));
    expect(state.byPoll["poll-1"]["voter-a"]).toBeDefined();

    // Voter themselves → removed, empty poll map cleaned up
    state = reducer(state, removeVoteByEventId({ eventId: "vote-1", byPubkey: "voter-a" }));
    expect(state.byPoll["poll-1"]).toBeUndefined();
    expect(state.byEventId["vote-1"]).toBeUndefined();
  });

  it("removePoll drops the aggregate and reverse entries", () => {
    let state = reducer(undefined, addPollVote(vote()));
    state = reducer(state, addPollVote(vote({ voter: "voter-b", eventId: "vote-2" })));
    state = reducer(state, removePoll("poll-1"));
    expect(state.byPoll["poll-1"]).toBeUndefined();
    expect(state.byEventId).toEqual({});
  });
});

describe("tallyPoll", () => {
  it("counts votes per option with winner detection", () => {
    const votes = {
      a: { optionIds: ["opt1"], createdAt: 100, eventId: "v1" },
      b: { optionIds: ["opt1"], createdAt: 100, eventId: "v2" },
      c: { optionIds: ["opt2"], createdAt: 100, eventId: "v3" },
    };
    const tally = tallyPoll(votes, makePoll());
    expect(tally.byOption).toEqual({ opt1: 2, opt2: 1 });
    expect(tally.totalVoters).toBe(3);
    expect(tally.winnerOptionIds).toEqual(["opt1"]);
  });

  it("singlechoice counts only the first known option id", () => {
    const votes = {
      a: { optionIds: ["bogus", "opt2", "opt1"], createdAt: 100, eventId: "v1" },
    };
    const tally = tallyPoll(votes, makePoll());
    expect(tally.byOption).toEqual({ opt1: 0, opt2: 1 });
  });

  it("multiplechoice counts each known option once", () => {
    const votes = {
      a: { optionIds: ["opt1", "opt2", "bogus"], createdAt: 100, eventId: "v1" },
    };
    const tally = tallyPoll(votes, makePoll({ pollType: "multiplechoice" }));
    expect(tally.byOption).toEqual({ opt1: 1, opt2: 1 });
    expect(tally.totalVoters).toBe(1);
  });

  it("ignores votes cast after endsAt", () => {
    const votes = {
      early: { optionIds: ["opt1"], createdAt: 100, eventId: "v1" },
      late: { optionIds: ["opt2"], createdAt: 1000, eventId: "v2" },
    };
    const tally = tallyPoll(votes, makePoll({ endsAt: 500 }));
    expect(tally.byOption).toEqual({ opt1: 1, opt2: 0 });
    expect(tally.totalVoters).toBe(1);
  });

  it("a vote with only unknown option ids does not count toward totals", () => {
    const votes = {
      a: { optionIds: ["nope"], createdAt: 100, eventId: "v1" },
    };
    const tally = tallyPoll(votes, makePoll());
    expect(tally.totalVoters).toBe(0);
    expect(tally.winnerOptionIds).toEqual([]);
  });

  it("member filter excludes outsiders and reports the count", () => {
    const votes = {
      member: { optionIds: ["opt1"], createdAt: 100, eventId: "v1" },
      outsider: { optionIds: ["opt2"], createdAt: 100, eventId: "v2" },
    };
    const tally = tallyPoll(votes, makePoll(), new Set(["member"]));
    expect(tally.byOption).toEqual({ opt1: 1, opt2: 0 });
    expect(tally.totalVoters).toBe(1);
    expect(tally.excludedNonMembers).toBe(1);
  });

  it("handles an empty vote map", () => {
    const tally = tallyPoll(undefined, makePoll());
    expect(tally.totalVoters).toBe(0);
    expect(tally.byOption).toEqual({ opt1: 0, opt2: 0 });
  });
});
