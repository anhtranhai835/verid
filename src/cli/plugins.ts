import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import { PLUGIN_EVENTS, pluginName, parsePluginSource } from "../core/plugins.js";
import { bilingual } from "../adapters/i18n.js";
import {
  checkPluginTools,
  checkPluginIntegrity,
  emitPluginEvent,
  installedManifest,
  installPlugin,
  pluginError,
  readPlugins,
  removePlugin,
} from "../adapters/plugins.js";
import { VeridError } from "../adapters/state-store.js";
import type { Io } from "../adapters/terminal.js";
import type { CliResult } from "./test.js";

export async function pluginCommand(project: string, args: string[], io?: Io): Promise<CliResult> {
  // All subcommands, including list, doctor and malformed requests, are developer commands.
  if (process.env.CLAUDECODE) throw new VeridError("VERID_BURNT_PLUGIN_IN_AGENT");
  const [command, ...rest] = args;
  const usage = () =>
    new VeridError("VERID_BURNT_PLUGIN_INVALID", {
      path: "plugin",
      detail:
        "usage: verid plugin add <source> [--yes] | remove <name> | list | doctor | run <event>",
    });
  if (command === "add") {
    const yes = rest.includes("--yes");
    const targets = rest.filter((arg) => arg !== "--yes");
    if (targets.length !== 1 || rest.length !== (yes ? 2 : 1)) throw usage();
    const source = targets[0]!;
    const parsed = parsePluginSource(source);
    if (!parsed.ok) throw new VeridError(parsed.code, { detail: parsed.detail });
    // An existing bare folder is a local path, even when its name is also an npm package.
    const local = parsed.source.kind === "npm" && !source.startsWith("npm:") && existsSync(source);
    let recorded = local ? `file:${source}` : source;
    if (resolve(process.cwd()) !== resolve(project)) {
      const fromCwd = (path: string) =>
        relative(project, resolve(process.cwd(), path)).replaceAll("\\", "/");
      if (local || parsed.source.kind === "file") {
        recorded = `file:${fromCwd(parsed.source.kind === "file" ? parsed.source.path : source)}`;
      } else if (
        parsed.source.kind === "git" &&
        !/^[a-z][\w+.-]*:\/\/|^[\w.-]+@[^/\\:]+:/i.test(parsed.source.remote)
      ) {
        recorded = `git:${fromCwd(parsed.source.remote)}${parsed.source.ref ? `#${parsed.source.ref}` : ""}`;
      }
    }
    await installPlugin(project, recorded, { yes, io });
    return { exit: 0, stdout: "", stderr: "" };
  }
  if (command === "remove" && rest.length === 1 && pluginName(rest[0]!)) {
    removePlugin(project, rest[0]!);
    return { exit: 0, stdout: `verid: removed plugin ${rest[0]} (plugin data kept)\n`, stderr: "" };
  }
  if (command === "run" && rest.length === 1) {
    const event = PLUGIN_EVENTS.find((name) => name === rest[0]);
    if (!event) throw usage();
    const payload =
      event === "taste"
        ? { sample: true, passed: true, counts: { passed: 1, failed: 0, skipped: 0 } }
        : event === "drive-stuck"
          ? { sample: true, reason: "sample" }
          : event === "drive-done"
            ? { sample: true }
            : { sample: true, module: "sample" };
    const warnings = await emitPluginEvent(project, event, payload);
    return { exit: 0, stdout: "", stderr: warnings.length ? `${warnings.join("\n")}\n` : "" };
  }
  if ((command === "list" || command === "doctor") && rest.length === 0) {
    if (command === "doctor") {
      try {
        checkPluginIntegrity(project);
      } catch (error) {
        return { exit: 1, stdout: "", stderr: `${pluginError(error)}\n` };
      }
    }
    const entries = readPlugins(project);
    const lines: string[] = [];
    const errors: string[] = [];
    for (const entry of entries) {
      if (command === "list") lines.push(`${entry.name} ${entry.resolved} <- ${entry.source}`);
      else {
        try {
          checkPluginIntegrity(project, entry);
          const manifest = installedManifest(project, entry);
          checkPluginTools(manifest);
          lines.push(`${manifest.name} ${manifest.version}: OK`);
        } catch (error) {
          errors.push(pluginError(error));
        }
      }
    }
    return {
      exit: errors.length ? 1 : 0,
      stdout: `${lines.length ? lines.join("\n") : entries.length ? "" : bilingual("plugin.empty", {})}\n`,
      stderr: errors.length ? `${errors.join("\n")}\n` : "",
    };
  }
  throw usage();
}
