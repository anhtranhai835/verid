import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests simulate developer terminals; explicit agent-guard cases supply their own markers.
    env: { CLAUDECODE: "", CODEX_THREAD_ID: "", CODEX_SESSION_ID: "", CODEX_TOOL_CALL_ID: "" },
    include: ["test/**/*.test.ts"],
    // e2e tests spawn real hook processes and wait on lock timeouts
    testTimeout: 20_000,
    // Half the cores: on a 12-core Windows machine 6 workers run as fast as 8, and the default
    // overloads it with spawned processes until tests time out.
    maxWorkers: "50%",
  },
});
