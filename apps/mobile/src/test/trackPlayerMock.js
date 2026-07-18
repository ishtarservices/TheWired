// Jest replacement for react-native-track-player (wired via moduleNameMapper).
// The real module evaluates its native TurboModule at import time, which has no
// host under Jest — so every suite that transitively imports playerService (and
// thus the screens) would throw. This standalone stub covers exactly the API
// surface the app uses. Enum VALUES mirror the real library so production code
// that branches on them behaves identically in tests.
//
// Test helpers: `__emit(event, payload)` drives a registered listener (the
// playerService event→Redux-mirror bridge test), `__resetMock()` clears
// listeners + call history between tests.

const listeners = new Map(); // event -> Set<handler>

const addEventListener = jest.fn((event, handler) => {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return { remove: () => listeners.get(event)?.delete(handler) };
});

// Named enum-likes — values match react-native-track-player exactly.
const Event = {
  PlaybackState: "playback-state",
  PlaybackActiveTrackChanged: "playback-active-track-changed",
  PlaybackQueueEnded: "playback-queue-ended",
  PlaybackError: "playback-error",
  PlaybackProgressUpdated: "playback-progress-updated",
  RemotePlay: "remote-play",
  RemotePause: "remote-pause",
  RemoteNext: "remote-next",
  RemotePrevious: "remote-previous",
  RemoteSeek: "remote-seek",
  RemoteStop: "remote-stop",
  RemoteDuck: "remote-duck",
  RemoteJumpForward: "remote-jump-forward",
  RemoteJumpBackward: "remote-jump-backward",
};

const State = {
  None: "none",
  Ready: "ready",
  Playing: "playing",
  Paused: "paused",
  Stopped: "stopped",
  Buffering: "buffering",
  Loading: "loading",
  Ended: "ended",
  Error: "error",
};

const Capability = {
  Play: "play",
  Pause: "pause",
  Stop: "stop",
  SkipToNext: "skip-to-next",
  SkipToPrevious: "skip-to-previous",
  SeekTo: "seek-to",
  JumpForward: "jump-forward",
  JumpBackward: "jump-backward",
};

const RepeatMode = { Off: 0, Track: 1, Queue: 2 };

const TrackType = {
  Default: "default",
  HLS: "hls",
  Dash: "dash",
  SmoothStreaming: "smoothstreaming",
};

const AppKilledPlaybackBehavior = {
  ContinuePlayback: "continue-playback",
  StopPlaybackAndRemoveNotification: "stop-playback-and-remove-notification",
  PausePlayback: "pause-playback",
};

// Imperative surface — jest.fn so tests can assert calls/order.
const TrackPlayer = {
  setupPlayer: jest.fn(() => Promise.resolve()),
  updateOptions: jest.fn(() => Promise.resolve()),
  registerPlaybackService: jest.fn(),
  add: jest.fn(() => Promise.resolve()),
  remove: jest.fn(() => Promise.resolve()),
  skip: jest.fn(() => Promise.resolve()),
  skipToNext: jest.fn(() => Promise.resolve()),
  skipToPrevious: jest.fn(() => Promise.resolve()),
  reset: jest.fn(() => Promise.resolve()),
  play: jest.fn(() => Promise.resolve()),
  pause: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  seekTo: jest.fn(() => Promise.resolve()),
  setRepeatMode: jest.fn(() => Promise.resolve()),
  getRepeatMode: jest.fn(() => Promise.resolve(RepeatMode.Off)),
  getProgress: jest.fn(() => Promise.resolve({ position: 0, duration: 0, buffered: 0 })),
  getActiveTrackIndex: jest.fn(() => Promise.resolve(0)),
  getActiveTrack: jest.fn(() => Promise.resolve(undefined)),
  getQueue: jest.fn(() => Promise.resolve([])),
  addEventListener,
};

// Hooks — return static defaults; component suites don't drive playback.
const useProgress = jest.fn(() => ({ position: 0, duration: 0, buffered: 0 }));
const useActiveTrack = jest.fn(() => undefined);
const usePlaybackState = jest.fn(() => ({ state: State.None }));
const useTrackPlayerEvents = jest.fn();
const useIsPlaying = jest.fn(() => ({ playing: false, bufferingDuringPlay: false }));

function __emit(event, payload) {
  listeners.get(event)?.forEach((h) => h(payload));
}

function __resetMock() {
  listeners.clear();
  for (const value of Object.values(TrackPlayer)) {
    if (typeof value?.mockClear === "function") value.mockClear();
  }
  addEventListener.mockClear();
}

module.exports = {
  __esModule: true,
  default: TrackPlayer,
  ...TrackPlayer,
  Event,
  State,
  Capability,
  RepeatMode,
  TrackType,
  AppKilledPlaybackBehavior,
  useProgress,
  useActiveTrack,
  usePlaybackState,
  useTrackPlayerEvents,
  useIsPlaying,
  __emit,
  __resetMock,
};
