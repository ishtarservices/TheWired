// Polyfills MUST load before anything else (crypto.getRandomValues for
// nostr-tools/@noble, URL, TextEncoder/Decoder on Hermes).
import "./src/platform/polyfills";

import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
