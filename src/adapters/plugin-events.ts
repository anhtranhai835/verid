import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { autoPhase } from "../core/auto.js";
import type { PluginEvent } from "../core/plugins.js";
import { autoFactsOf } from "./plan-file.js";
import { loadManifest } from "./manifest.js";
import {
  checkPluginIntegrity,
  emitPluginEvent,
  pluginError,
  pluginEventWarning,
  pluginPath,
  readPlugins,
} from "./plugins.js";
import { readState, statePaths, VeridError, withLock } from "./state-store.js";

interface Cursor {
  phase: string;
  served: Record<string, string>;
}

/** Called after the hook decided and saved state. Plugins never run under its decision lock. */
export async function notifyAutoPlugins(project: string): Promise<string[]> {
  // One budget for all events and plugins in this hook, including a close followed by an open.
  const deadline = Date.now() + 1000;
  try {
    checkPluginIntegrity(project);
    if (!readPlugins(project).length) return [];
    const manifest = await loadManifest(project, { readOnly: true });
    if (manifest?.drive !== "auto") return [];
    const paths = statePaths(project);
    const pending = withLock(paths, () => {
      const state = readState(paths);
      const phase = autoPhase(autoFactsOf(project, state, manifest.iterations !== undefined));
      const cursor: Cursor = {
        phase: JSON.stringify([
          state.auto.signed?.at,
          phase.kind,
          phase.kind === "module" ? phase.view.name : phase.kind === "stuck" ? phase.reason : null,
        ]),
        served: Object.fromEntries(
          Object.entries(state.modules).flatMap(([name, approval]) =>
            approval.served_at === null ? [] : [[name, approval.served_at]],
          ),
        ),
      };
      const file = join(paths.dir, "plugin-drive.json");
      pluginPath(project, ".state/plugin-drive.json");
      const before = existsSync(file)
        ? (JSON.parse(readFileSync(file, "utf8")) as Cursor)
        : { phase: "", served: {} };
      const events: { event: PluginEvent; input: Record<string, unknown> }[] = [];
      for (const [name, at] of Object.entries(cursor.served))
        if (before.served[name] !== at)
          events.push({ event: "module-served", input: { module: name } });
      if (cursor.phase !== before.phase) {
        if (phase.kind === "module")
          events.push({ event: "module-opened", input: { module: phase.view.name } });
        if (phase.kind === "stuck")
          events.push({ event: "drive-stuck", input: { reason: phase.reason } });
        if (phase.kind === "done") events.push({ event: "drive-done", input: {} });
      }
      // Save the observation before dispatch; a crashing observer is not retried on every Stop.
      writeFileSync(file, JSON.stringify(cursor));
      return events;
    });
    const warnings: string[] = [];
    for (const { event, input } of pending)
      warnings.push(...(await emitPluginEvent(project, event, input, deadline)));
    return warnings;
  } catch (error) {
    if (error instanceof VeridError && error.code === "VERID_BURNT_PLUGIN_INTEGRITY")
      return [pluginEventWarning(project, "plugins.json", "auto", "integrity", pluginError(error))];
    // This is observer setup only. The caller's already-computed decision remains untouched.
    return [pluginEventWarning(project, "observer", "auto", "observer", pluginError(error))];
  }
}
