import { isOverridable } from "../core/errors.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import { appendAudit } from "../adapters/audit-log.js";
import { bilingual } from "../adapters/i18n.js";
import {
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";
import type { CliResult } from "./test.js";

/**
 * `verid tip "<reason>"` (developer only): the terminal form of `/verid tip` + `/verid confirm`,
 * for a host with no attended prompt (Codex). Running it in a terminal is the confirmation, as for
 * `verid order`, so it allows the last denied action once. Inside an agent it refuses, and the
 * hook keeps agents' shells from running it.
 */
export function tipCommand(project: string, reason: string): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_TIP_IN_AGENT");
  const paths = statePaths(project);
  return withLock(paths, () => {
    const state = readState(paths);
    const d = state.last_denied;
    if (!d) throw new VeridError("VERID_BURNT_OVERRIDE_NOTHING");
    if (!isOverridable(d.rule))
      throw new VeridError("VERID_BURNT_OVERRIDE_FORBIDDEN", { rule: d.rule, target: d.target });
    const created = {
      session: d.session,
      rule: d.rule,
      tool: d.tool,
      target: d.target,
      input_hash: d.input_hash,
      reason,
      created_at: new Date().toISOString(),
      used: false,
    };
    // Audit first: if it fails, no exception exists.
    appendAudit(paths.audit, { event: "override_created", via: "terminal", ...created });
    writeState(paths, {
      ...state,
      pending_override: null,
      overrides: [...state.overrides, created],
    });
    return {
      exit: 0,
      stdout: `${bilingual("override.created", { tool: d.tool, target: d.target })}\n`,
      stderr: "",
    };
  });
}
