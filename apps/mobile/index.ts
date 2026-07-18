// Polyfills MUST load before anything else (crypto.getRandomValues for
// nostr-tools/@noble, URL, TextEncoder/Decoder on Hermes).
import "./src/platform/polyfills";

import { registerRootComponent } from "expo";
import TrackPlayer from "react-native-track-player";

import App from "./App";

// Register the RNTP playback service (lock screen / remote controls). Must run
// once at module load, before the player is set up. The factory returns the
// service function — see src/lib/music/service.ts.
TrackPlayer.registerPlaybackService(() => require("./src/lib/music/service").default);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
