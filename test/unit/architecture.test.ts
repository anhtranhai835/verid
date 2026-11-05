import { describe, expect, it } from "vitest";
import { architectureProblems, checkerStatus } from "../../src/core/architecture.js";

const result = (status: "pass" | "fail" | "unavailable", snapshot = "s1") => ({
  snapshot,
  status,
  run: "20261027T000000Z-abcd",
  log: ".verid/.state/runs/20261027T000000Z-abcd/architecture-0.log",
  at: "2026-10-27T00:00:00.000Z",
  detail: status === "unavailable" ? "timed out after 1 s" : "",
});

describe("architecture checks", () => {
  it("reads a checker's exit: 0 passes, other codes fail, and no start, not found or a timeout show nothing", () => {
    const rows: [number | null, boolean, string][] = [
      [0, false, "pass"],
      [1, false, "fail"],
      [2, false, "fail"],
      [null, false, "unavailable"],
      [null, true, "unavailable"],
      [126, false, "unavailable"],
      [127, false, "unavailable"],
      [9009, false, "unavailable"],
    ];
    expect(rows.map(([exit, timedOut]) => checkerStatus(exit, timedOut))).toEqual(
      rows.map(([, , want]) => want),
    );
  });

  it("reports the last checker result for each configured repo as an advisory", () => {
    const rows = [
      [undefined, "VERID_BURNT_ARCHITECTURE_STALE"],
      ["pass", null],
      ["fail", "VERID_BURNT_ARCHITECTURE_FAILED"],
      ["unavailable", "VERID_BURNT_ARCHITECTURE_UNAVAILABLE"],
    ] as const;
    for (const [status, code] of rows) {
      const warnings = architectureProblems(
        [{ repo: "api" }],
        status ? { api: result(status) } : {},
      );
      expect(warnings[0]?.code ?? null).toBe(code);
    }
  });
});
