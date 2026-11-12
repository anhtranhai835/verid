import { inAgentShell } from "../adapters/agent-environment.js";
import { bilingual } from "../adapters/i18n.js";
import { appendAudit } from "../adapters/audit-log.js";
import {
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import type { CliResult } from "./test.js";

/**
 * `verid garnish`: the developer declares that this conversation only refactors. A new
 * conversation starts in RAW (hook.ts), which would lock production code for a pure refactor;
 * only the developer may open it, and only while every test passed in the last run.
 */
export function refactor(project: string): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_REFACTOR_IN_AGENT");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const { last_run, failing } = state.tdd;
    if (last_run === null || failing.length > 0)
      throw new VeridError("VERID_BURNT_REFACTOR_NOT_GREEN");
    if (state.tdd.state !== "PLATED") {
      appendAudit(paths.audit, { event: "tdd_refactor", from: state.tdd.state });
      writeState(paths, {
        ...state,
        tdd: { ...state.tdd, state: "PLATED", rev: state.tdd.rev + 1 },
      });
    }
    return {
      exit: 0,
      stdout: `verid: TDD PLATED · last run ${last_run}\n${bilingual("status.plated", {})}\n`,
      stderr: "",
    };
  });
}
