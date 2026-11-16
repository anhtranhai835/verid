import { basename, dirname } from "node:path";
import { setupPreview } from "../core/setup-plan.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import { bilingual } from "../adapters/i18n.js";
import { checkSetupPath } from "../adapters/workspace.js";
import { VeridError } from "../adapters/state-store.js";
import type { CliResult } from "./test.js";
import { planCodexMachine } from "./cook/providers.js";

/** Installer entry point: register the user-layer role without creating any project files. */
export function setupCodexCommand(): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_INIT_IN_AGENT");
  const plan = planCodexMachine();
  for (const write of plan.writes) checkSetupPath(dirname(write.path), basename(write.path));
  for (const write of plan.writes) write.apply();
  return {
    exit: 0,
    stdout: `${setupPreview(plan.files, [bilingual("cook.codex_trust", {})]).join("\n")}\n`,
    stderr: "",
  };
}
