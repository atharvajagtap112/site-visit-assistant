import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

export default defineConfig({
  test: {
    // Review agents work in git worktrees under .claude/.
    exclude: ["node_modules/**", ".claude/**"],
    globalSetup: "./tests/global-setup.ts",
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? "" },
    // All test files share one database and truncate it between tests.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
