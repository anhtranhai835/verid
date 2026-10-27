import type { ArchitectureResult } from "./state.js";

export type ArchitectureStatus = ArchitectureResult["status"];

/**
 * A repo's snapshot as the freshness check reads it: a key over its files, checker settings, design
 * and module, or why there is none (an input matching nothing, unreadable, or linked outside).
 */
export type Snapshot = { key: string } | { unavailable: string };

export type ArchitectureCode =
  | "VERID_BURNT_ARCHITECTURE_FAILED"
  | "VERID_BURNT_ARCHITECTURE_STALE"
  | "VERID_BURNT_ARCHITECTURE_UNAVAILABLE";

export interface ArchitectureProblem {
  code: ArchitectureCode;
  repo: string;
  detail: string;
  log: string;
}

// 126: found but not executable; 127: not found by sh; 9009: not found by cmd.exe.
const NOT_LAUNCHED = new Set([126, 127, 9009]);

/** What one checker run shows: exit 0 passes, another code fails; no start or a timeout shows nothing. */
export function checkerStatus(exit: number | null, timedOut: boolean): ArchitectureStatus {
  if (timedOut || exit === null || NOT_LAUNCHED.has(exit)) return "unavailable";
  return exit === 0 ? "pass" : "fail";
}

/**
 * Why each configured repo keeps the open module from closing, in manifest order: no snapshot to
 * check, no result for the snapshot it has now, or a result that did not pass. Empty when every
 * repo passed on its current snapshot, and when no repo configures a check.
 */
export function architectureProblems(
  current: readonly { repo: string; snapshot: Snapshot }[],
  results: Readonly<Record<string, ArchitectureResult>>,
): ArchitectureProblem[] {
  return current.flatMap(({ repo, snapshot }): ArchitectureProblem[] => {
    const problem = (code: ArchitectureCode, detail = "", log = "") => [
      { code, repo, detail, log },
    ];
    if ("unavailable" in snapshot)
      return problem("VERID_BURNT_ARCHITECTURE_UNAVAILABLE", snapshot.unavailable);
    const result = results[repo];
    if (result === undefined || result.snapshot !== snapshot.key)
      return problem("VERID_BURNT_ARCHITECTURE_STALE");
    if (result.status === "fail") return problem("VERID_BURNT_ARCHITECTURE_FAILED", "", result.log);
    if (result.status === "unavailable")
      return problem("VERID_BURNT_ARCHITECTURE_UNAVAILABLE", result.detail, result.log);
    return [];
  });
}
