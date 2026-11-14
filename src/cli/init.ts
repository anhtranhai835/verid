import { existsSync } from "node:fs";
import { setupPreview, type PlannedFile } from "../core/setup-plan.js";
import { ask, type Io } from "../adapters/terminal.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import type { InitFlags, Repo, Layout, Provider } from "../core/manifest.js";
import { bilingual } from "../adapters/i18n.js";
import { loadManifest, manifestFile } from "../adapters/manifest.js";
import { readState, statePaths, VeridError } from "../adapters/state-store.js";
import { restorePlugins } from "../adapters/plugin-store.js";
import type { CliResult } from "./test.js";
import { cookInputs } from "./cook/inputs.js";
import { planExistingManifest, planNewManifest } from "./cook/manifest.js";
import { createPlanner } from "./cook/planner.js";
import { pathAnswers } from "../adapters/workspace.js";
import {
  planInstructions,
  planClaudeSettings,
  planCodex,
  planCommands,
  noteSharedHooks,
} from "./cook/providers.js";
import { planRepos, cookApplier } from "./cook/repos.js";
import { planResources, planRulesAndDocs } from "./cook/resources.js";
import { planState, planGitignore } from "./cook/state.js";

/** What `verid cook` will do, checked and not yet written: `apply` writes it. */
export interface CookPlan {
  layout: Layout;
  providers: readonly Provider[];
  steps: PlannedFile[];
  notes: string[];
  files: PlannedFile[];
  /** Preview actions and intended writes; kept files' contents do not affect confirmation. */
  revision: string;
  /** The repo of the manifest it will create, when it creates one. */
  repo?: Repo;
  apply: () => { failed: boolean; stdout: string; stderr: string };
}

/**
 * `verid cook`: set verid up for the project (committed: the manifest and .verid/.gitignore) and
 * for this machine (state, and hooks in .claude/settings.local.json pointing at this verid).
 * Everything is checked before anything is written, and nothing that exists is overwritten
 * except verid's own hook entries. Safe to run again, and by each teammate after cloning.
 */
export async function initCommand(
  project: string,
  flags: InitFlags,
  io?: Io,
  command: "cook" | "upgrade" = "cook",
): Promise<CliResult> {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_INIT_IN_AGENT");
  if (command === "upgrade" && !existsSync(manifestFile(project)))
    throw new VeridError("VERID_BURNT_MANIFEST_MISSING", { path: manifestFile(project) });
  if (command === "upgrade" && !io && !flags.yes && !flags.dryRun)
    throw new VeridError("VERID_BURNT_UPGRADE_NO_TERMINAL");
  const chosen: InitFlags = {
    ...flags,
    ...((flags.yes || command === "upgrade") && { upgrade: true }),
  };
  // A new reheat project needs the legacy folder: a terminal is asked, a script must pass --legacy.
  if (
    command === "cook" &&
    flags.mode === "reheat" &&
    flags.legacy === undefined &&
    io &&
    !flags.yes &&
    !existsSync(manifestFile(project))
  ) {
    const typed = (await ask(io, bilingual("cook.legacy", {})))?.trim();
    if (typed) chosen.legacy = typed;
  }
  let plan = await planCook(project, chosen, command === "upgrade");
  const preview = () =>
    (io?.output ?? process.stdout).write(
      [`verid ${command} (${project})`, ...setupPreview(plan.files, plan.notes), ""].join("\n"),
    );
  preview();
  if (flags.dryRun) return { exit: 0, stdout: `${bilingual("init.dry_run", {})}\n`, stderr: "" };
  for (let round = 0; ; round++) {
    if (io && !flags.yes) {
      const answer = await ask(io, bilingual("cook.confirm", {}));
      if (answer === null || !["", "y", "yes"].includes(answer.toLowerCase()))
        return { exit: 0, stdout: `${bilingual("cook.cancelled", {})}\n`, stderr: "" };
    }
    const fresh = await planCook(project, chosen, command === "upgrade");
    const changed = fresh.revision !== plan.revision;
    plan = fresh;
    if (!changed) break;
    if (round === 2) throw new VeridError("VERID_BURNT_INIT_UNSTABLE");
    preview();
  }
  const result = plan.apply();
  if (result.failed) return { exit: 1, stdout: result.stdout, stderr: result.stderr };
  await restorePlugins(project, Boolean(flags.yes), io);
  // The same ending as the screen in a terminal: what to commit, then what to do next.
  const out = [
    result.stdout,
    setupDoneLine(plan.layout, plan.providers),
    await servedLine(project),
  ].filter(Boolean);
  return {
    exit: 0,
    stdout: `${out.join("\n")}\n`,
    stderr: "",
  };
}

/** cook's last line: the next step, which in remix is the baseline, until there is one. */
export async function servedLine(project: string): Promise<string> {
  const manifest = await loadManifest(project, { readOnly: true });
  const providers = manifest?.providers ?? ["claude-code"];
  const agent = providers.includes("claude-code") ? "Claude Code" : "Codex";
  const remix = manifest?.mode === "remix";
  const first = remix && readState(statePaths(project)).baseline === null;
  const key =
    agent === "Claude Code"
      ? first
        ? "cook.served_remix"
        : manifest?.mode === "reheat"
          ? "cook.served_reheat"
          : "cook.served"
      : "cook.codex_served";
  // The last line is the one sentence to say to the agent; the onboard skill answers it.
  return `🍽️  ${bilingual(key, {})}\n💬 ${bilingual("cook.say_next", { agent })}`;
}

/** Completion follows the provider files that were actually generated. */
export function setupDoneLine(layout: Layout, providers: readonly Provider[]): string {
  return bilingual(
    providers.includes("claude-code")
      ? layout === "workspace"
        ? "workspace.done"
        : "init.done"
      : layout === "workspace"
        ? "workspace.codex_done"
        : "init.codex_done",
    { instructions: providers.includes("claude-code") ? "AGENTS.md  CLAUDE.md" : "AGENTS.md" },
  );
}

/** Checks everything `verid cook` needs and returns what it would write, writing nothing. */
export async function planCook(
  project: string,
  flags: InitFlags,
  refreshCommands = false,
): Promise<CookPlan> {
  // Claude Code sets CLAUDECODE in every session: an agent that deleted .verid must
  // not be able to rebuild it with fresh counters, no audit trail and maybe no manifest.
  if (inAgentShell()) throw new VeridError("VERID_BURNT_INIT_IN_AGENT");

  const p = createPlanner(project);
  const existing = await loadManifest(project, { readOnly: true, checkPaths: false });
  const inputs = cookInputs(p, flags, existing);
  const { providers, claude, language, layout } = inputs;
  planState(p, existing, language, inputs.sees, inputs.scopedRunners);
  planGitignore(p);

  const manifest = existing
    ? {
        ...(await planExistingManifest(p, flags, existing, providers)),
        repo: undefined,
        reheatRepos: undefined,
      }
    : planNewManifest(p, flags, layout, inputs.detected, providers);
  const { effective, roles, repo } = manifest;
  planResources(p, flags, existing, effective, providers);
  planRulesAndDocs(p, effective);
  const { configured, missing } = planRepos(p, flags, {
    existing,
    reheatRepos: manifest.reheatRepos,
    layout,
    detected: inputs.detected,
    repo,
    sees: inputs.sees,
    claude,
    effective,
    roles,
  });
  planInstructions(p, effective, providers);
  planClaudeSettings(p, inputs.settingsFile, inputs.settingsText, inputs.merged);
  planCodex(p, providers, inputs.hook, effective);
  const commandFiles = planCommands(p, claude, language, refreshCommands);
  noteSharedHooks(p, claude);

  const apply = cookApplier(p, layout, configured, missing, existing);
  const { steps, writes, machineWrites, notes, checkWritePath } = p;
  const files = [...steps.filter((s) => s.rel !== ".claude/commands/verid/"), ...commandFiles];
  const answers = pathAnswers();
  for (const write of writes) checkWritePath(write.rel, answers);
  const revision = JSON.stringify({
    files,
    writes: writes.map(({ rel, content }) => ({ rel, content })),
    machineWrites: machineWrites.map(({ path, content }) => ({ path, content })),
    notes,
    repo,
    layout,
    repos: configured,
  });
  return {
    layout,
    providers,
    steps,
    files,
    notes,
    revision,
    ...(repo !== undefined && { repo }),
    apply,
  };
}
