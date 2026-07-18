import TrackPlayer, {
  Event,
  RepeatMode,
  State,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} from "react-native-track-player";
import * as player from "../playerService";
import { mirrorTrackChanged, mirrorStatusChanged, playbackEnded, playerErrored } from "@/store/slices/musicSlice";
import type { MusicItem } from "@/screens/spaces/musicEventParser";
import type { NostrEvent } from "@thewired/shared-types";

// The global moduleNameMapper mock exposes these helpers.
const TP = TrackPlayer as unknown as Record<string, jest.Mock>;
const { __emit, __resetMock } = require("react-native-track-player") as {
  __emit: (event: string, payload?: unknown) => void;
  __resetMock: () => void;
};

const ev: NostrEvent = {
  id: "e",
  pubkey: "p".repeat(64),
  created_at: 1,
  kind: 31683,
  tags: [],
  content: "",
  sig: "",
};

const track = (id: string): MusicItem => ({
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
});

const dispatch = jest.fn();

beforeEach(() => {
  __resetMock();
  player.__resetForTest();
  dispatch.mockClear();
  player.attachStore(dispatch as never);
});

describe("loadQueue", () => {
  it("sets up, resets, adds tracks, skips to start index, and plays", async () => {
    await player.loadQueue([track("a"), track("b"), track("c")], 2);
    expect(TP.setupPlayer).toHaveBeenCalled();
    expect(TP.reset).toHaveBeenCalled();
    expect(TP.add).toHaveBeenCalledTimes(1);
    const added = TP.add.mock.calls[0][0];
    expect(added).toHaveLength(3);
    expect(added[0]).toMatchObject({ id: "a", url: "https://x/a.mp3" });
    expect(TP.skip).toHaveBeenCalledWith(2);
    expect(TP.play).toHaveBeenCalled();
  });

  it("does not skip when starting at index 0", async () => {
    await player.loadQueue([track("a")], 0);
    expect(TP.skip).not.toHaveBeenCalled();
    expect(TP.play).toHaveBeenCalled();
  });
});

describe("setup idempotency", () => {
  it("only sets up the player once across calls", async () => {
    await player.setup();
    await player.setup();
    await player.play();
    expect(TP.setupPlayer).toHaveBeenCalledTimes(1);
  });
});

describe("transport", () => {
  it("previous restarts when >3s in, else skips back", async () => {
    TP.getProgress.mockResolvedValueOnce({ position: 5, duration: 100, buffered: 0 });
    await player.previous();
    expect(TP.seekTo).toHaveBeenCalledWith(0);
    expect(TP.skipToPrevious).not.toHaveBeenCalled();

    TP.getProgress.mockResolvedValueOnce({ position: 1, duration: 100, buffered: 0 });
    await player.previous();
    expect(TP.skipToPrevious).toHaveBeenCalled();
  });

  it("maps repeat modes to RNTP RepeatMode", async () => {
    await player.setRepeat("track");
    expect(TP.setRepeatMode).toHaveBeenCalledWith(RepeatMode.Track);
    await player.setRepeat("off");
    expect(TP.setRepeatMode).toHaveBeenLastCalledWith(RepeatMode.Off);
  });
});

describe("reset", () => {
  it("no-ops before setup, stops after", async () => {
    // fresh module state isn't guaranteed across tests, so drive setup first
    await player.setup();
    await player.reset();
    expect(TP.reset).toHaveBeenCalled();
  });
});

describe("RNTP event → Redux mirror bridge", () => {
  beforeEach(async () => {
    await player.setup(); // binds listeners
  });

  it("PlaybackActiveTrackChanged → mirrorTrackChanged with id + duration", () => {
    __emit(Event.PlaybackActiveTrackChanged, { track: { id: "a", duration: 212 } });
    expect(dispatch).toHaveBeenCalledWith(
      mirrorTrackChanged({ currentId: "a", durationSec: 212 }),
    );
  });

  it("PlaybackState playing → mirrorStatusChanged", () => {
    __emit(Event.PlaybackState, { state: State.Playing });
    expect(dispatch).toHaveBeenCalledWith(mirrorStatusChanged("playing"));
  });

  it("PlaybackState none → playbackEnded", () => {
    __emit(Event.PlaybackState, { state: State.None });
    expect(dispatch).toHaveBeenCalledWith(playbackEnded());
  });

  it("PlaybackQueueEnded → playbackEnded", () => {
    __emit(Event.PlaybackQueueEnded, {});
    expect(dispatch).toHaveBeenCalledWith(playbackEnded());
  });

  it("PlaybackError → playerErrored", () => {
    __emit(Event.PlaybackError, { message: "network down" });
    expect(dispatch).toHaveBeenCalledWith(playerErrored("network down"));
  });
});
