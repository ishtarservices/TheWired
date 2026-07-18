// RNTP playback service — registered in index.ts via registerPlaybackService.
// This runs OUTSIDE React (it must respond when the UI is torn down), wiring
// the lock screen / Control Center / headphone/Bluetooth/car remote events to
// TrackPlayer. Redux-mirror event handling lives in playerService.ts; keep this
// file limited to remote-control forwarding so it stays valid as a headless
// service entrypoint.

import TrackPlayer, { Event } from "react-native-track-player";

export default async function playbackService(): Promise<void> {
  TrackPlayer.addEventListener(Event.RemotePlay, () => {
    void TrackPlayer.play();
  });
  TrackPlayer.addEventListener(Event.RemotePause, () => {
    void TrackPlayer.pause();
  });
  TrackPlayer.addEventListener(Event.RemoteNext, () => {
    void TrackPlayer.skipToNext();
  });
  TrackPlayer.addEventListener(Event.RemotePrevious, () => {
    void TrackPlayer.skipToPrevious();
  });
  TrackPlayer.addEventListener(Event.RemoteStop, () => {
    void TrackPlayer.stop();
  });
  TrackPlayer.addEventListener(Event.RemoteSeek, (e) => {
    if (typeof e?.position === "number") void TrackPlayer.seekTo(e.position);
  });
  // Audio-session interruptions (incoming call, other app takes the session).
  TrackPlayer.addEventListener(Event.RemoteDuck, (e) => {
    if (e?.permanent) {
      void TrackPlayer.stop();
      return;
    }
    void (e?.paused ? TrackPlayer.pause() : TrackPlayer.play());
  });
}
