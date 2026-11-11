import type { PluginEvent } from "../core/plugin.js";
import { appendAudit } from "./audit-log.js";
import { bilingual } from "./i18n.js";
import { checkedPlugin, pluginEnvironment, readPlugins } from "./plugin-store.js";
import { runPluginCommand } from "./plugin-process.js";
import { statePaths, VeridError, withLock } from "./state-store.js";
export { runPluginCommand } from "./plugin-process.js";

/** Events run after the decision is persisted. No plugin output is interpreted as gate input. */
export async function emitPluginEvent(
  project: string,
  event: PluginEvent,
  payload: Record<string, unknown>,
): Promise<string> {
  const warnings: string[] = [];
  const warn = (name: string, error: unknown) => {
    const detail = (
      error instanceof VeridError
        ? `${error.code}: ${error.params.detail ?? ""}`
        : error instanceof Error
          ? error.message
          : String(error)
    )
      .replace(/[\r\n]+/g, " ")
      .slice(0, 400);
    warnings.push(
      `verid [VERID_BURNT_PLUGIN_EVENT] ${bilingual("VERID_BURNT_PLUGIN_EVENT", { name, event, detail }).replace(/[\r\n]+/g, " ")}\n`,
    );
    try {
      const paths = statePaths(project);
      withLock(paths, () =>
        appendAudit(paths.audit, {
          event: "plugin_hook_failed",
          plugin: name,
          hook: event,
          detail,
        }),
      );
    } catch {
      warnings.push(`verid: plugin ${name}: audit unavailable\n`);
    }
  };
  try {
    for (const entry of readPlugins(project).plugins) {
      if (!entry.enabled) continue;
      try {
        const { manifest, folder } = checkedPlugin(project, entry);
        const command = manifest.hooks[event];
        if (!command) continue;
        const result = await runPluginCommand(
          command,
          folder,
          {
            ...pluginEnvironment(project, entry.name, folder, entry.config),
            VERID_PLUGIN_EVENT: event,
          },
          JSON.stringify({ ...payload, event }),
        );
        if (result.exit !== 0)
          throw new Error(
            result.timedOut
              ? "hook timed out after 300 s"
              : `hook exited ${result.exit}: ${result.stderr}`,
          );
        if (result.stdout.trim()) {
          const json: unknown = JSON.parse(result.stdout);
          if (json === null || typeof json !== "object" || Array.isArray(json))
            throw new Error("hook output must be a JSON object or empty");
        }
      } catch (error) {
        warn(entry.name, error);
      }
    }
  } catch (error) {
    warn("plugins.json", error);
  }
  return warnings.join("");
}
