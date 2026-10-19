import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // e2e tests spawn real hook processes and wait on lock timeouts
    testTimeout: 20_000,
  },
});
