import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __APP_VERSION__: '"0.0.0-test"',
  },
  envDir: path.resolve(__dirname, ".."),
  envPrefix: "TEST_",
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/types/**",
        "src/workers/**",
        "src/__tests__/**",
        "src/**/*.d.ts",
      ],
    },
    deps: {
      optimizer: {
        web: {
          include: ["nostr-tools", "@noble/curves", "@noble/hashes"],
        },
      },
    },
  },
});
