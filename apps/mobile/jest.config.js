module.exports = {
  preset: "jest-expo",
  // pnpm keeps the real packages under node_modules/.pnpm/<pkg>@<ver>/node_modules/…,
  // so jest-expo's RN-transform allowlist must also match through that layout.
  transformIgnorePatterns: [
    "node_modules/(?!(?:\\.pnpm/[^/]+/node_modules/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|nativewind|react-native-css-interop|lucide-react-native|react-native-worklets|react-native-reanimated|@gorhom/bottom-sheet|immer|redux|@reduxjs/.*|reselect|nostr-tools|@noble/.*|@scure/.*))",
  ],
};
