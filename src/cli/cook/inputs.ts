import { join, resolve } from "node:path";
import {
  LAYOUTS,
  PROVIDERS,
  WORKFLOWS,
  RESOURCE_MODES,
  type InitFlags,
  type Repo,
  type Manifest,
  type Provider,
} from "../../core/manifest.js";
import { withVeridHooks } from "../../adapters/claude-settings.js";
import { bilingual } from "../../adapters/i18n.js";
import { isDirectory } from "../../adapters/manifest.js";
import { findRunners } from "../../adapters/test-runner.js";
import { checkWorkspaceRoot, detectLayout, validateRepoPaths } from "../../adapters/workspace.js";
import { projectHook } from "../../adapters/hook-wiring.js";
import { invalid, type Planner, readText } from "./planner.js";

const LANGS = ["vi", "en"] as const;

/** The runners verid sees in a repo whose test command it finds itself; null when the manifest names one. */
export type Sees = (repo: Repo) => ReturnType<typeof findRunners> | null;

/**
 * What cook works from, checked before anything is planned: the flags that name a choice, the
 * providers, this machine's Claude Code settings, the layout, and the runners verid sees.
 */
export function cookInputs(p: Planner, flags: InitFlags, existing: Manifest | null) {
  const { project, notes } = p;
  const settingsFile = join(project, ".claude", "settings.local.json");
  if (flags.workflow !== undefined && !WORKFLOWS.some((value) => value === flags.workflow))
    throw invalid("--workflow", "verid has one flow; drop this flag");
  if (["classic", "kanban"].includes(flags.workflow ?? ""))
    notes.push(bilingual("init.workflow_ignored", {}));
  if (flags.resources !== undefined && !RESOURCE_MODES.some((value) => value === flags.resources))
    throw invalid("--resources", "must be installed or repo");
  const resources = existing ? existing.resources : flags.resources;
  const hook = projectHook(project, resources);

  // The language for this machine's messages, kept in its state.
  const language = flags.lang === undefined ? undefined : LANGS.find((l) => l === flags.lang);
  if (flags.lang !== undefined && !language) throw invalid("--lang", "must be vi or en");
  if (flags.providers?.some((provider) => !PROVIDERS.some((known) => known === provider)))
    throw invalid("--provider", "must be claude-code or codex");
  const providers: Provider[] =
    existing?.providers ??
    (flags.providers?.length ? ([...new Set(flags.providers)] as Provider[]) : ["claude-code"]);
  const claude = providers.includes("claude-code");
  const settingsText = claude ? readText(settingsFile) : null;
  let merged: ReturnType<typeof withVeridHooks> | undefined;
  if (claude) {
    try {
      merged = withVeridHooks(settingsText === null ? {} : JSON.parse(settingsText), hook);
    } catch (e) {
      throw invalid(settingsFile, e instanceof Error ? e.message : String(e));
    }
  }
  if (flags.layout !== undefined && !LAYOUTS.some((layout) => layout === flags.layout))
    throw invalid("--layout", "must be monorepo or workspace");
  const requested = LAYOUTS.find((layout) => layout === flags.layout);
  const detected = existing ? null : detectLayout(project, requested);
  const layout = existing?.layout ?? requested ?? detected?.layout ?? "monorepo";
  if (layout === "workspace") checkWorkspaceRoot(project);
  if (!existing && layout === "workspace" && !detected?.repos.length)
    throw invalid(
      "--layout workspace",
      "no direct child git repos found; add a child repo or a shared .verid/manifest.yaml",
    );
  if (existing) validateRepoPaths(project, existing, true);
  notes.push(`layout: ${layout}`);
  // The runners verid sees now, when the manifest leaves the test command to verid.
  const scopedRunners = existing?.layout === "workspace" || (existing?.repos.length ?? 0) > 1;
  const sees = (repo: Repo) =>
    repo.test_cmd === undefined && isDirectory(resolve(project, ...repo.path.split(/[/\\]/)))
      ? findRunners(resolve(project, ...repo.path.split(/[/\\]/)), {
          sourceGlobs: repo.source_globs,
          testGlobs: repo.test_globs,
          ignoreGlobs: repo.ignore_globs ?? [],
        })
      : null;
  return {
    settingsFile,
    hook,
    language,
    providers,
    claude,
    settingsText,
    merged,
    detected,
    layout,
    scopedRunners,
    sees,
  };
}
