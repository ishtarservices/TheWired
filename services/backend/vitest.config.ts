import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: [
        "src/routes/**",
        "src/services/**",
        "src/workers/**",
        "src/middleware/**",
      ],
    },
  },
});
