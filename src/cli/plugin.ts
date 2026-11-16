import { inAgentShell } from "../adapters/agent-environment.js";
import { bilingual } from "../adapters/i18n.js";
import {
  installPlugin,
  pluginProblems,
  readPlugins,
  removePlugin,
} from "../adapters/plugin-store.js";
import { VeridError } from "../adapters/state-store.js";
import type { Io } from "../adapters/terminal.js";
import type { CliResult } from "./test.js";

export async function pluginCommand(
  project: string,
  args: readonly string[],
  io?: Io,
): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_PLUGIN_IN_AGENT");
  const [action, target, flag, ...rest] = args;
  let stdout: string;
  if (action === "add" && target && (flag === undefined || flag === "--yes") && rest.length === 0) {
    const installed = await installPlugin(project, target, { yes: flag === "--yes", io });
    stdout = bilingual(installed.cancelled ? "plugin.cancelled" : "plugin.added", {
      name: installed.name,
    });
  } else if (action === "remove" && target && flag === undefined) {
    removePlugin(project, target);
    stdout = bilingual("plugin.removed", { name: target });
  } else if (action === "list" && target === undefined) {
    const entries = readPlugins(project).plugins;
    stdout = entries.length
      ? entries
          .map(
            (p) =>
              `${p.name}@${p.version} ${p.enabled ? "enabled" : "disabled"} ${p.source}${p.commit ? ` ${p.commit}` : ""}`,
          )
          .join("\n")
      : bilingual("plugin.empty", {});
  } else if (action === "doctor" && target === undefined) {
    const problems = await pluginProblems(project);
    return {
      exit: problems.length ? 1 : 0,
      stdout: (problems.length ? problems.join("\n") : bilingual("plugin.healthy", {})) + "\n",
      stderr: "",
    };
  } else
    throw new VeridError("VERID_BURNT_PLUGIN_INVALID", {
      path: "plugin",
      detail: "plugin add <file:path|git:url#ref> [--yes] | remove <name> | list | doctor",
    });
  return { exit: 0, stdout: stdout + "\n", stderr: "" };
}
