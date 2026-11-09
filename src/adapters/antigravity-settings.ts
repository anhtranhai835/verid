import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ANTIGRAVITY_EVENTS } from "./antigravity.js";
import { installationRoot } from "./codex-settings.js";
import { resourceTree, type ResourceFile } from "./repo-resources.js";
import { VeridError } from "./state-store.js";

/** Where Antigravity loads user plugins from; verid's lives in its own folder. */
export const antigravityPluginDir = (): string =>
  join(homedir(), ".gemini", "config", "plugins", "verid");

/** The shim each hook runs, relative to the plugin folder. */
export const ANTIGRAVITY_SHIM = "hooks/antigravity-hook.mjs";

/**
 * The installed plugin mirrors the npm package: the Antigravity entries at its root, the bundle
 * in dist/ (with its i18n/ beside it), and skills, agents and templates in plugin/. The bundle
 * then finds its content exactly as it does from node_modules.
 */
export function antigravityPluginFiles(): ResourceFile[] {
  const root = installationRoot();
  const source = join(root, "plugin", "antigravity");
  const dist = join(root, "dist");
  for (const dir of [source, dist, join(root, "i18n")])
    if (!existsSync(dir))
      throw new VeridError("VERID_BURNT_INIT_INVALID", {
        path: dir,
        detail: "run setup-antigravity from an installed or built verid (npm run build)",
      });
  return [
    ...resourceTree(source, ""),
    ...resourceTree(dist, "dist"),
    ...resourceTree(join(root, "i18n"), "i18n"),
    ...["skills", "agents", "templates"].flatMap((dir) =>
      resourceTree(join(root, "plugin", dir), `plugin/${dir}`),
    ),
    { rel: "package.json", content: Buffer.from('{"type":"module","private":true}\n') },
  ].map((file) => ({ ...file, rel: file.rel.replace(/^\//, "") }));
}

/** Whether the plugin is installed and its hooks run verid for every event it judges. */
export function antigravityPluginInstalled(dir = antigravityPluginDir()): boolean {
  let hooks: unknown;
  try {
    hooks = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
  } catch {
    return false;
  }
  if (!existsSync(join(dir, ANTIGRAVITY_SHIM)) || !existsSync(join(dir, "dist", "hook-run.js")))
    return false;
  const text = JSON.stringify(hooks);
  return ANTIGRAVITY_EVENTS.every((event) =>
    text.includes(`${ANTIGRAVITY_SHIM.replace(/^hooks\//, "./hooks/")} ${event}`),
  );
}
