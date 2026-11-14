import { BaseSequencer, type TestSpecification } from "vitest/node";
import { defineConfig } from "vitest/config";

// Seconds each slow file took on the Windows runner with 2 workers; every other file counts as
// SMALL_FILE. The default `--shard` split hashes paths, which put installers and station (273 s
// together) in one CI shard. This one hands the slowest files out first, each to the shard with
// the least work so far, so no shard waits on two of them.
const SLOW_FILES: Record<string, number> = {
  "test/e2e/installers.e2e.test.ts": 146,
  "test/e2e/station.e2e.test.ts": 127,
  "test/e2e/doctor.e2e.test.ts": 73,
  "test/e2e/tdd.e2e.test.ts": 70,
};
const SMALL_FILE = 5;

class BalancedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard ?? { index: 1, count: 1 };
    const cost = (file: TestSpecification) =>
      SLOW_FILES[file.moduleId.slice(this.ctx.config.root.length + 1).replaceAll("\\", "/")] ??
      SMALL_FILE;
    const sorted = [...files].sort(
      (a, b) => cost(b) - cost(a) || a.moduleId.localeCompare(b.moduleId),
    );
    const totals = Array<number>(count).fill(0);
    return sorted.filter((file) => {
      const lightest = totals.indexOf(Math.min(...totals));
      totals[lightest] = (totals[lightest] ?? 0) + cost(file);
      return lightest === index - 1;
    });
  }
}

export default defineConfig({
  test: {
    // Tests simulate developer terminals; explicit agent-guard cases supply their own markers.
    env: { CLAUDECODE: "", CODEX_THREAD_ID: "", CODEX_SESSION_ID: "", CODEX_TOOL_CALL_ID: "" },
    include: ["test/**/*.test.ts"],
    // The board embeds its stylesheets as text (`?raw`); by default Vitest empties every CSS import.
    css: true,
    // Windows e2e cases launch several CLI/Git processes and clean up their files.
    // Allow for scheduler/filesystem stalls; runner deadlines are asserted separately.
    testTimeout: process.platform === "win32" ? 90_000 : 20_000,
    // CLI/Git subprocesses already add concurrency. Bound Windows workers to keep the
    // real-process e2e cases within their timeout even on slower disks and OneDrive. The
    // windows-latest runner has 4 vCPU and a local disk, so CI uses all four.
    maxWorkers: process.platform === "win32" ? (process.env.CI ? 4 : 2) : "50%",
    sequence: { sequencer: BalancedSequencer },
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
