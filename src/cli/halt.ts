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
 * `verid halt [reason]`: the developer's kill switch. Until `verid resume`, the hook denies every
 * tool call of every agent, past any `/verid tip`, and holds no Stop. Halting again replaces the
 * reason.
 */
export function halt(project: string, words: readonly string[]): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_HALT_IN_AGENT");
  const reason = words.join(" ").trim() || "no reason given";
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    // Audit first: if it fails, state is untouched and verid is not halted.
    appendAudit(paths.audit, { event: "halted", reason });
    writeState(paths, { ...state, halted: { at: new Date().toISOString(), reason } });
    return {
      exit: 0,
      stdout: `verid: halted · ${reason}\n${bilingual("halt.done", {})}\n`,
      stderr: "",
    };
  });
}

/** `verid resume`: lifts `verid halt`; the agent's calls are judged by every rule again. */
export function resume(project: string): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_HALT_IN_AGENT");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    if (state.halted === null) return { exit: 0, stdout: "verid: not halted\n", stderr: "" };
    appendAudit(paths.audit, { event: "resumed" });
    writeState(paths, { ...state, halted: null });
    return { exit: 0, stdout: `verid: resumed\n${bilingual("resume.done", {})}\n`, stderr: "" };
  });
}
