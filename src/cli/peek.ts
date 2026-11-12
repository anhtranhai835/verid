import { join } from "node:path";
import { guardsToolCalls } from "../adapters/claude-settings.js";
import { hasCurrentCodexHooks } from "../adapters/codex-settings.js";
import { bilingual } from "../adapters/i18n.js";
import { loadManifest } from "../adapters/manifest.js";
import { peekLines } from "../adapters/plan-file.js";
import { readState, statePaths } from "../adapters/state-store.js";
import { lastRefusal, type CliResult } from "./test.js";
import { projectHook } from "../adapters/hook-wiring.js";
import { readJson } from "./shell.js";

export async function status(project: string): Promise<CliResult> {
  const state = readState(statePaths(project));
  const manifest = await loadManifest(project);
  // A teammate who cloned the project but never ran cook has state and manifest, and no hooks.
  const hook = projectHook(project);
  const claude = ["settings.local.json", "settings.json"].some((f) =>
    guardsToolCalls(readJson(join(project, ".claude", f)), hook),
  );
  const guarded = (manifest?.providers ?? ["claude-code"]).every((provider) =>
    provider === "codex"
      ? hasCurrentCodexHooks(readJson(join(project, ".codex", "hooks.json")), hook)
      : claude,
  );
  const stderr = guarded ? "" : `${bilingual("status.no_hooks", {})}\n`;
  // The gate follows the manifest, not state: say so when it is off (an invalid one throws).
  const lines = peekLines(
    project,
    manifest?.mode ?? null,
    state,
    manifest?.roles,
    manifest?.drive,
    manifest ?? undefined,
  );
  const refused = lastRefusal(project, state.tdd.last_run);
  if (refused)
    lines.push(
      bilingual("status.last_refused", { run: refused.run, code: refused.code }),
      bilingual(refused.code, refused.params),
      ...(refused.hint
        ? [bilingual(refused.hint.key, { ...refused.hint.params, command: "taste" })]
        : []),
    );
  return { exit: 0, stdout: `${lines.join("\n")}\n`, stderr };
}
