// Metro config for the pnpm monorepo. Since SDK 52, expo/metro-config detects
// monorepos itself (watchFolders → workspace root, symlink-aware resolution),
// so we only *extend* its defaults — never replace them (expo-doctor treats
// hard overrides as breakage).
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Make sure the whole workspace is watched so edits to shared packages
// (@thewired/shared-types, later @thewired/core) hot-reload.
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

// Resolve from the app's node_modules first, then the workspace root — keeps a
// single React / react-native instance (the app's own) when shared packages
// are symlinked in.
config.resolver.nodeModulesPaths = [
  ...new Set([
    path.resolve(projectRoot, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
    ...(config.resolver.nodeModulesPaths ?? []),
  ]),
];

module.exports = withNativeWind(config, { input: "./global.css" });
