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

  it("keeps a module open until every configured repo passed on the snapshot it has now", () => {
    type Row = [
      string,
      Parameters<typeof architectureProblems>[0],
      Parameters<typeof architectureProblems>[1],
    ];
    const rows: Row[] = [
      ["no repo configured", [], {}],
      ["fresh pass", [{ repo: "api", snapshot: { key: "s1" } }], { api: result("pass") }],
      ["never run", [{ repo: "api", snapshot: { key: "s1" } }], {}],
      ["files changed since", [{ repo: "api", snapshot: { key: "s2" } }], { api: result("pass") }],
      ["checker failed", [{ repo: "api", snapshot: { key: "s1" } }], { api: result("fail") }],
      [
        "checker timed out",
        [{ repo: "api", snapshot: { key: "s1" } }],
        { api: result("unavailable") },
      ],
      [
        "an input matches nothing",
        [{ repo: "api", snapshot: { unavailable: "input rules/*.cjs matches no file" } }],
        { api: result("pass") },
      ],
      ["a stale failure", [{ repo: "api", snapshot: { key: "s2" } }], { api: result("fail") }],
      [
        "one of two repos failed",
        [
          { repo: "api", snapshot: { key: "s1" } },
          { repo: "web", snapshot: { key: "s1" } },
        ],
        { api: result("pass"), web: result("fail") },
      ],
    ];
    const outcome = ([, current, results]: Row) =>
      architectureProblems(current, results).map((p) => `${p.repo} ${p.code} ${p.detail}`.trim());
    expect(Object.fromEntries(rows.map((row) => [row[0], outcome(row)]))).toEqual({
      "no repo configured": [],
      "fresh pass": [],
      "never run": ["api VERID_BURNT_ARCHITECTURE_STALE"],
      "files changed since": ["api VERID_BURNT_ARCHITECTURE_STALE"],
      "checker failed": ["api VERID_BURNT_ARCHITECTURE_FAILED"],
      "checker timed out": ["api VERID_BURNT_ARCHITECTURE_UNAVAILABLE timed out after 1 s"],
      "an input matches nothing": [
        "api VERID_BURNT_ARCHITECTURE_UNAVAILABLE input rules/*.cjs matches no file",
      ],
      "a stale failure": ["api VERID_BURNT_ARCHITECTURE_STALE"],
      "one of two repos failed": ["web VERID_BURNT_ARCHITECTURE_FAILED"],
    });
  });
});
