jest.mock("@/lib/music/playerService");

import * as playerService from "@/lib/music/playerService";
import {
  playQueue,
  togglePlay,
  cycleRepeat,
  toggleShuffle,
} from "../music";
import { itemsUpserted, queueLoaded, shuffleApplied, playerErrored } from "../slices/musicSlice";
import type { RootState } from "@/store";
import type { MusicItem } from "@/screens/spaces/musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

const mockPlayer = playerService as jest.Mocked<typeof playerService>;

const ev: NostrEvent = {
  id: "e",
  pubkey: "p".repeat(64),
  created_at: 1,
  kind: 31683,
  tags: [],
  content: "",
  sig: "",
};

const track = (id: string, over: Partial<MusicItem> = {}): MusicItem => ({
  id,
  event: ev,
  kind: "track",
  addressableId: id,
  title: id,
  artist: "A",
  artwork: null,
  audioUrl: `https://x/${id}.mp3`,
  visibility: "public",
  artistPubkeys: [],
  ...over,
});

/** Drive a thunk with a collecting dispatch + a fixed state. */
function drive(thunk: (d: unknown, g: unknown, e: unknown) => Promise<void>, state: Partial<RootState>) {
  const actions: unknown[] = [];
  const dispatch: (a: unknown) => unknown = (a) => {
    if (typeof a === "function") {
      return (a as (d: unknown, g: unknown, e: unknown) => unknown)(dispatch, () => state, {});
    }
    actions.push(a);
    return a;
  };
  const getState = () => state as RootState;
  return { actions, dispatch, promise: thunk(dispatch, getState, {}) };
}

beforeEach(() => jest.clearAllMocks());

describe("playQueue", () => {
  it("filters unplayable items, remaps the start index, and loads the queue", async () => {
    const items = [
      track("a"),
      track("alb", { kind: "album", audioUrl: null }), // dropped
      track("b"),
      track("priv", { visibility: "private" }), // dropped
      track("c"),
    ];
    // startIndex 4 points at "c" in the original list.
    const { actions, promise } = drive(playQueue(items, 4) as never, { music: {} } as never);
    await promise;

    expect(actions).toContainEqual(itemsUpserted([track("a"), track("b"), track("c")]));
    expect(actions).toContainEqual(
      queueLoaded({ queueIds: ["a", "b", "c"], currentId: "c" }),
    );
    // playable = [a, b, c]; "c" is index 2 there.
    expect(mockPlayer.loadQueue).toHaveBeenCalledWith(
      [track("a"), track("b"), track("c")],
      2,
    );
  });

  it("errors and does not load when nothing is playable", async () => {
    const { actions, promise } = drive(
      playQueue([track("alb", { kind: "album", audioUrl: null })], 0) as never,
      { music: {} } as never,
    );
    await promise;
    expect(actions).toContainEqual(playerErrored("Nothing playable here"));
    expect(mockPlayer.loadQueue).not.toHaveBeenCalled();
  });
});

describe("togglePlay", () => {
  it("pauses when playing, plays otherwise", async () => {
    await drive(togglePlay() as never, { music: { player: { status: "playing" } } } as never).promise;
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockPlayer.play).not.toHaveBeenCalled();

    jest.clearAllMocks();
    await drive(togglePlay() as never, { music: { player: { status: "paused" } } } as never).promise;
    expect(mockPlayer.play).toHaveBeenCalled();
  });
});

describe("cycleRepeat", () => {
  it("cycles off → queue → track → off", async () => {
    const setRepeat = mockPlayer.setRepeat;

    await drive(cycleRepeat() as never, { music: { player: { repeat: "off" } } } as never).promise;
    expect(setRepeat).toHaveBeenLastCalledWith("queue");

    await drive(cycleRepeat() as never, { music: { player: { repeat: "queue" } } } as never).promise;
    expect(setRepeat).toHaveBeenLastCalledWith("track");

    await drive(cycleRepeat() as never, { music: { player: { repeat: "track" } } } as never).promise;
    expect(setRepeat).toHaveBeenLastCalledWith("off");
  });
});

describe("toggleShuffle", () => {
  const state = {
    music: {
      itemsById: { a: track("a"), b: track("b"), c: track("c") },
      player: {
        originalOrder: ["a", "b", "c"],
        currentId: "b",
        shuffle: false,
      },
    },
  };

  it("turning on pins current first and rebuilds the RNTP queue", async () => {
    const { actions, promise } = drive(toggleShuffle() as never, state as never);
    await promise;
    const applied = actions.find(
      (a): a is ReturnType<typeof shuffleApplied> =>
        (a as { type?: string }).type === shuffleApplied.type,
    );
    expect(applied?.payload.shuffle).toBe(true);
    expect(applied?.payload.queueIds[0]).toBe("b"); // current pinned first
    expect([...applied!.payload.queueIds].sort()).toEqual(["a", "b", "c"]);
    expect(mockPlayer.applyQueueOrder).toHaveBeenCalled();
  });

  it("turning off restores the original order", async () => {
    const on = { music: { ...state.music, player: { ...state.music.player, shuffle: true } } };
    const { actions, promise } = drive(toggleShuffle() as never, on as never);
    await promise;
    const applied = actions.find(
      (a): a is ReturnType<typeof shuffleApplied> =>
        (a as { type?: string }).type === shuffleApplied.type,
    );
    expect(applied?.payload.shuffle).toBe(false);
    expect(applied?.payload.queueIds).toEqual(["a", "b", "c"]);
  });
});
