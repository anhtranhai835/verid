#!/usr/bin/env node
import type { ErrorCode, MessageKey } from "../core/errors.js";
import { projectDir } from "../adapters/claude-code.js";
import { bilingual } from "../adapters/i18n.js";
import { readState, statePaths, VeridError } from "../adapters/state-store.js";
import { testCommand, type CliResult } from "./test.js";

/** verid CLI. Exit 2 means verid refused or failed, and nothing counted as evidence. */
async function main(): Promise<void> {
  // Same project as the hook: Claude Code's project dir, else where the command runs.
  const project = projectDir(process.cwd());
  const [cmd, ...rest] = process.argv.slice(2);
  let r: CliResult;
  try {
    if (cmd === "test" && rest.length === 0) r = await testCommand(project);
    else if (cmd === "status" && rest.length === 0) r = status(project);
    else r = { exit: 2, stdout: "", stderr: `${bilingual("cli.usage", {})}\n` };
  } catch (err) {
    const code: ErrorCode = err instanceof VeridError ? err.code : "VERID_E_INTERNAL";
    const params =
      err instanceof VeridError
        ? err.params
        : { detail: err instanceof Error ? err.message : String(err) };
    r = { exit: 2, stdout: "", stderr: `verid [${code}]\n${bilingual(code, params)}\n` };
  }
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  process.exitCode = r.exit;
}

function status(project: string): CliResult {
  const { state, last_run } = readState(statePaths(project)).tdd;
  const hint = `status.${state.toLowerCase()}` as MessageKey;
  return {
    exit: 0,
    stdout: `verid: TDD ${state} · last run ${last_run ?? "none"}\n${bilingual(hint, {})}\n`,
    stderr: "",
  };
}

await main();
