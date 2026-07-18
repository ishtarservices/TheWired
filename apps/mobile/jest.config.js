module.exports = {
  preset: "jest-expo",
  // pnpm keeps the real packages under node_modules/.pnpm/<pkg>@<ver>/node_modules/…,
  // so jest-expo's RN-transform allowlist must also match through that layout.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nativewind|react-native-css-interop|lucide-react-native|react-native-worklets|react-native-reanimated|@gorhom/bottom-sheet|immer|react-redux|redux|@reduxjs/.*|reselect|use-sync-external-store|nostr-tools|@noble/.*|@scure/.*))",
  ],
  moduleNameMapper: {
    // Reanimated's worklets runtime has no Jest host; use the official mock
    // (+ our useReducedMotion patch — see src/test/reanimatedMock.js).
    "^react-native-reanimated$": "<rootDir>/src/test/reanimatedMock.js",
    // RNTP evaluates its native TurboModule at import time (no Jest host); every
    // suite that transitively imports the player would throw. Stub it globally.
    "^react-native-track-player$": "<rootDir>/src/test/trackPlayerMock.js",
  },
};
