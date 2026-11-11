import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Manifest } from "../core/manifest.js";
import { withVeridHooks } from "./claude-settings.js";
import { withCodexHooks } from "./codex-settings.js";
import { checkSetupPath } from "./workspace.js";

export const projectHook = (project: string, resources?: string): string =>
  resources === "repo"
    ? join(project, ".verid/hooks/hook.js")
    : fileURLToPath(new URL("./hook.js", import.meta.url));

/** Machine wiring only; committed resources and developer configuration remain intact. */
export function wireProjectHooks(project: string, manifest: Manifest): void {
  const hook = projectHook(project, manifest.resources);
  const files = [
    ...(manifest.providers.includes("claude-code")
      ? [{ path: ".claude/settings.local.json", merge: withVeridHooks }]
      : []),
    ...(manifest.providers.includes("codex")
      ? [{ path: ".codex/hooks.json", merge: withCodexHooks }]
      : []),
  ].map(({ path, merge }) => {
    checkSetupPath(project, path);
    const file = join(project, path);
    const before = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    return { file, settings: merge(before, hook).settings };
  });
  for (const { file, settings } of files) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
  }
}
