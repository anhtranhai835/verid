import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests simulate developer terminals; explicit agent-guard cases supply their own markers.
    env: { CLAUDECODE: "", CODEX_THREAD_ID: "", CODEX_SESSION_ID: "", CODEX_TOOL_CALL_ID: "" },
    include: ["test/**/*.test.ts"],
    // Windows e2e cases launch several CLI/Git processes and clean up their files.
    // Allow for scheduler/filesystem stalls; runner deadlines are asserted separately.
    testTimeout: process.platform === "win32" ? 90_000 : 20_000,
    // CLI/Git subprocesses already add concurrency. Bound Windows workers to keep the
    // real-process e2e cases within their timeout even on slower disks and OneDrive.
    maxWorkers: process.platform === "win32" ? 2 : "50%",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary", "json-summary"],
      // Floors of the full suite's coverage on Windows, so it cannot drop unnoticed. Raise them
      // when coverage rises; lower one only in its own commit that says why.
      thresholds: { lines: 94, statements: 92, branches: 85, functions: 96 },
    },
  },
});
