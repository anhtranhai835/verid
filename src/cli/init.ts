import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setupPreview, type Action, type PlannedFile } from "../core/setup-plan.js";
import { ask, type Io } from "../adapters/terminal.js";
import { inAgentShell } from "../adapters/agent-environment.js";
import {
  pluginIgnore,
  pluginPath,
  pluginNeedsRestore,
  readPlugins,
  restorePlugins,
} from "../adapters/plugins.js";
import {
  DEFAULT_ROLES,
  DRIVES,
  LAYOUTS,
  manifestUpgrade,
  MODES,
  PROVIDERS,
  ROLE_NAMES,
  parseManifest,
  providerRoles,
  renderManifest,
  suggestManifest,
  suggestMode,
  type InitFlags,
  type Repo,
  type ProjectFacts,
  type Roles,
  type Layout,
  type Manifest,
  type Provider,
} from "../core/manifest.js";
import { instructionFile, mergeInstructions, renderInstructions } from "../core/instructions.js";
import { goneRunners, runnerKey, runnerLabel, type Runner } from "../core/runners.js";
import { hasVeridHooks, withVeridHooks } from "../adapters/claude-settings.js";
import {
  codexHome,
  installedSkills,
  mergeCodexReviewer,
  reviewerOverlay,
  reviewerContent,
  withCodexHooks,
} from "../adapters/codex-settings.js";
import { bilingual, t, type Lang } from "../adapters/i18n.js";
import {
  isDirectory,
  loadManifest,
  manifestFile,
  missingManifestDefaults,
  upgradeManifestText,
} from "../adapters/manifest.js";
import { findRunners } from "../adapters/test-runner.js";
import {
  checkSetupPath,
  checkWorkspaceRoot,
  cloneMarkerFile,
  cloneMissingRepo,
  detectLayout,
  initWorkspaceGit,
  validateRepoPaths,
} from "../adapters/workspace.js";
import {
  errno,
  languageOf,
  readState,
  statePaths,
  VeridError,
  withLock,
  writeState,
} from "../adapters/state-store.js";

import type { CliResult } from "./test.js";

const LANGS = ["vi", "en"] as const;

export type { Action } from "../core/setup-plan.js";

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

const invalid = (path: string, detail: string) =>
  new VeridError("VERID_BURNT_INIT_INVALID", { path, detail });

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
  const warnings = await restorePlugins(project, { yes: flags.yes, io });
  // The same ending as the screen in a terminal: what to commit, then what to do next.
  const out = [
    result.stdout,
    setupDoneLine(plan.layout, plan.providers),
    await servedLine(project),
  ].filter(Boolean);
  return {
    exit: warnings.length ? 1 : 0,
    stdout: `${out.join("\n")}\n`,
    stderr: warnings.length ? `${warnings.join("\n")}\n` : "",
  };
}

/** cook's last line: the next step, which in remix is the baseline, until there is one. */
export async function servedLine(project: string): Promise<string> {
  const manifest = await loadManifest(project, { readOnly: true });
  if (manifest && !manifest.providers.includes("claude-code"))
    return `🍽️  ${bilingual("cook.codex_served", {})}`;
  const remix = manifest?.mode === "remix";
  const first = remix && readState(statePaths(project)).baseline === null;
  return `🍽️  ${bilingual(first ? "cook.served_remix" : "cook.served", {})}`;
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
    { instructions: providers.map(instructionFile).join("  ") },
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

  const paths = statePaths(project);
  const steps: CookPlan["steps"] = [];
  const writes: Array<{ rel: string; content: unknown; apply: () => void }> = [];
  const machineWrites: Array<{ path: string; content: string; apply: () => void }> = [];
  const notes: string[] = [];
  const checkWritePath = (rel: string) => {
    try {
      checkSetupPath(project, rel);
    } catch (error) {
      if (
        providers.some((provider) => instructionFile(provider) === rel) &&
        error instanceof VeridError &&
        error.code === "VERID_BURNT_MANIFEST_INVALID"
      )
        throw new VeridError("VERID_BURNT_INSTRUCTIONS_LINKED", { path: rel });
      throw error;
    }
  };
  const step = (action: Action, rel: string, write?: { content: unknown; apply: () => void }) => {
    steps.push({ action, rel });
    if (write) writes.push({ rel, ...write });
  };

  const settingsFile = join(project, ".claude", "settings.local.json");
  const hook = fileURLToPath(new URL("./hook.js", import.meta.url));

  // The language for this machine's messages, kept in its state.
  const language = flags.lang === undefined ? undefined : LANGS.find((l) => l === flags.lang);
  if (flags.lang !== undefined && !language) throw invalid("--lang", "must be vi or en");
  const existing = await loadManifest(project, { readOnly: true, checkPaths: false });
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
  let effective: Manifest | undefined = existing ?? undefined;
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
  if (existsSync(paths.file)) {
    const state = readState(paths); // a broken state stops cook: the developer must look at it
    // The developer running cook again is how a runner whose build file is gone is dropped.
    const now = existing?.repos.flatMap(
      (repo) => sees(repo)?.runners.map((r) => runnerKey(r, scopedRunners ? repo.path : ".")) ?? [],
    );
    const gone = now ? goneRunners(state.runners, now) : [];
    if (gone.length > 0)
      notes.push(
        bilingual("init.runners_forgotten", { runners: gone.map(runnerLabel).join(", ") }),
      );
    if ((language && state.language !== language) || gone.length > 0)
      step("updated", ".verid/.state/state.json", {
        // Compare only the merge we will perform, not fields hooks keep updating.
        content: { ...(language && { language }), forgetRunners: gone },
        apply: () =>
          withLock(paths, () => {
            const s = readState(paths);
            writeState(paths, {
              ...s,
              ...(language && { language }),
              runners: s.runners.filter((k) => !gone.includes(k)),
            });
          }),
      });
    else step("kept", ".verid/.state/state.json");
  } else {
    // Every other field has a default (core/state.ts).
    const fresh = { schemaVersion: 1, ...(language && { language }) };
    const text = `${JSON.stringify(fresh)}\n`;
    step("created", ".verid/.state/state.json", {
      content: text,
      apply: () => writeFileSync(paths.file, text, { flag: "wx" }),
    });
  }

  const gitignore = join(project, ".verid", ".gitignore");
  const ignoreBefore = readText(gitignore);
  const ignoreAfter = pluginIgnore(ignoreBefore ?? ".state/\n");
  if (ignoreBefore === ignoreAfter) step("kept", ".verid/.gitignore");
  // `wx`: a file that appeared since the check is the developer's, never overwritten.
  else
    step(ignoreBefore === null ? "created" : "updated", ".verid/.gitignore", {
      content: ignoreAfter,
      apply: () =>
        writeFileSync(gitignore, ignoreAfter, ignoreBefore === null ? { flag: "wx" } : {}),
    });
  for (const plugin of readPlugins(project)) {
    if (pluginNeedsRestore(project, plugin)) {
      step(
        existsSync(pluginPath(project, `plugins/${plugin.name}`)) ? "updated" : "created",
        `.verid/plugins/${plugin.name}/`,
      );
      notes.push(
        `${plugin.name} <- ${plugin.source} (${plugin.resolved})\n${bilingual("plugin.unofficial", {})}`,
      );
    }
  }

  let repo: Repo | undefined;
  // The roles the manifest maps once cook is done: verid's own unless the developer chose others.
  let roles: Roles | null | undefined;
  const flagsGiven =
    flags.mode !== undefined ||
    flags.drive !== undefined ||
    flags.layout !== undefined ||
    flags.providers !== undefined ||
    flags.iterations !== undefined ||
    flags.duration !== undefined ||
    flags.startDate !== undefined ||
    flags.demoDay !== undefined ||
    flags.testCmd !== undefined ||
    flags.src.length > 0 ||
    flags.tests.length > 0;
  if (existing) {
    const upgrades = existing.repos.map((repo) => manifestUpgrade(repo, existing.roles));
    const upgrade = upgrades[0];
    roles =
      flags.upgrade && upgrade?.roles ? { ...existing.roles, ...upgrade.roles } : existing.roles;
    if (flags.upgrade) roles = providerRoles(roles ?? undefined, providers);
    const missingDefaults = await missingManifestDefaults(readText(manifestFile(project)) ?? "");
    const items = manifestUpgradeLines(existing, missingDefaults);
    if (upgrade && items.length > 0 && flags.upgrade) {
      // Edited on what is there now, checked before anything is written.
      let text = readText(manifestFile(project)) ?? "";
      for (const [i, up] of upgrades.entries()) text = await upgradeManifestText(text, up, i);
      step("updated", ".verid/manifest.yaml", {
        content: text,
        apply: () => writeFileSync(manifestFile(project), text),
      });
    } else step("kept", ".verid/manifest.yaml");
    // Without a terminal to ask in, the developer hears what a cook in their terminal would add.
    if (items.length > 0 && flags.upgrade === undefined)
      notes.push(bilingual("init.upgrade", {}), ...items);
    if (flagsGiven) notes.push(bilingual("init.flags_ignored", {}));
    effective = {
      ...existing,
      ...(flags.upgrade &&
        missingDefaults.includes("allowed_agents") && { allowed_agents: ["general-purpose"] }),
      ...(roles && { roles }),
    };
  } else {
    // A new manifest needs the developer's choice of mode: the folder only suggests one.
    const facts = projectFacts(
      project,
      layout === "workspace" ? detected?.repos.map((repo) => repo.path) : undefined,
    );
    if (flags.mode === undefined && !flags.yes && !flags.dryRun)
      throw new VeridError("VERID_BURNT_INIT_NO_MODE", { suggested: suggestMode(facts) });
    const mode = MODES.find((m) => m === (flags.mode ?? suggestMode(facts)));
    if (!mode) throw invalid("--mode", "must be prep, recipe or remix");
    const drive = flags.drive === undefined ? undefined : DRIVES.find((d) => d === flags.drive);
    if (flags.drive !== undefined && !drive) throw invalid("--drive", "must be human or auto");
    if (
      !flags.iterations &&
      [flags.duration, flags.startDate, flags.demoDay].some((v) => v !== undefined)
    )
      throw invalid("--iterations", "required with --duration, --start-date or --demo-day");

    const suggested = suggestManifest(flags);
    const repos =
      layout === "workspace"
        ? (detected?.repos ?? []).map((repo) => ({ ...suggested, ...repo }))
        : [suggested];
    const checked = parseManifest({
      schemaVersion: 1,
      mode,
      roles: providerRoles(DEFAULT_ROLES, providers),
      drive,
      layout,
      providers,
      allowed_agents: ["general-purpose"],
      ...(flags.iterations && {
        iterations: {
          duration: flags.duration,
          start_date: flags.startDate,
          demo_day: flags.demoDay,
        },
      }),
      repos,
    });
    if (!checked.ok) {
      const repoField = /^repos\.(\d+)\.(path|remote|default_branch):/.exec(checked.detail);
      const iterationField = /^iterations(?:\.(\w+))?:/.exec(checked.detail);
      const iterationFlag = {
        duration: "--duration",
        start_date: "--start-date",
        demo_day: "--demo-day",
      };
      throw invalid(
        repoField
          ? resolve(project, repos[Number(repoField[1])]?.path ?? ".")
          : iterationField
            ? (iterationFlag[iterationField[1] as keyof typeof iterationFlag] ?? "--iterations")
            : checked.detail.startsWith("drive:")
              ? "--drive"
              : "--test-cmd/--src/--tests",
        checked.detail,
      );
    }
    const text = renderManifest(
      mode,
      repos,
      providerRoles(DEFAULT_ROLES, providers),
      drive,
      layout,
      checked.manifest.iterations,
      providers,
    );
    effective = checked.manifest;
    if (checked.manifest.iterations) {
      const { duration, start_date, demo_day } = checked.manifest.iterations;
      notes.push(
        `iterations:\n  duration: ${JSON.stringify(duration)}\n  start_date: ${JSON.stringify(start_date)}\n  demo_day: ${JSON.stringify(demo_day)}`,
      );
    }
    roles = providerRoles(DEFAULT_ROLES, providers);
    if (layout === "monorepo") repo = suggested;
    step("created", ".verid/manifest.yaml", {
      content: text,
      apply: () => writeFileSync(manifestFile(project), text, { flag: "wx" }),
    });
  }
  const configured =
    existing?.repos ??
    (layout === "workspace"
      ? (detected?.repos ?? []).map((repo) => ({ ...suggestManifest(flags), ...repo }))
      : [repo!]);
  const missing = configured.filter(
    (repo) => !existsSync(resolve(project, ...repo.path.split(/[/\\]/))),
  );
  if (layout === "workspace") {
    validateRepoPaths(project, { layout, repos: configured }, true);
    step(existsSync(join(project, ".verid", ".git")) ? "kept" : "created", ".verid/.git/");
  }
  for (const repo of missing) {
    step("created", `${repo.path.replaceAll("\\", "/")}/`);
    notes.push(
      `${repo.path} <- ${repo.remote ?? "(no remote)"}${repo.default_branch ? ` (${repo.default_branch})` : ""}`,
    );
  }
  for (const repo of configured) {
    const seen = sees(repo);
    if (!seen) continue;
    const scoped = seen.runners.map((r) => ({
      ...r,
      dir: runnerKey(r, repo.path).slice(r.name.length + 1),
    }));
    notes.push(runnersNote(scoped));
    // By default vitest and jest pick up Playwright's specs, and Playwright their tests.
    const names = seen.runners.map((r) => r.name);
    if (names.includes("playwright") && (names.includes("vitest") || names.includes("jest")))
      notes.push(bilingual("cook.e2e_split", {}));
  }
  // verid's agents come from its plugin, installed on each machine apart from the npm package.
  if (
    claude &&
    Object.values(roles ?? {}).some((agents) => agents?.some((a) => a.startsWith("verid:")))
  ) {
    const optional = (["researcher", "architect", "planner", "qa"] as const).some(
      (role) => roles?.[role],
    );
    notes.push(
      bilingual(optional ? "cook.mapped_roles" : "cook.roles", {
        agents: ROLE_NAMES.flatMap((role) => roles?.[role] ?? []).join(", "),
      }),
    );
  }

  for (const provider of providers) {
    const rel = instructionFile(provider);
    checkWritePath(rel);
    const file = join(project, rel);
    const before = readText(file);
    const result = mergeInstructions(
      before ?? undefined,
      renderInstructions(effective!, provider, installedSkills()),
    );
    if (!result.ok) throw invalid(file, result.detail);
    if (before === result.content) step("kept", rel);
    else
      step(before === null ? "created" : "updated", rel, {
        content: result.content,
        apply: () => writeFileSync(file, result.content, before === null ? { flag: "wx" } : {}),
      });
  }

  if (merged) {
    const rel = ".claude/settings.local.json";
    const settingsContent = `${JSON.stringify(merged.settings, null, 2)}\n`;
    const write = {
      content: settingsContent,
      apply: () => {
        mkdirSync(join(project, ".claude"), { recursive: true });
        writeFileSync(settingsFile, settingsContent);
      },
    };
    if (settingsText === null) step("created", rel, write);
    else if (merged.changed) step("updated", rel, write);
    else step("kept", rel);
  }

  if (providers.includes("codex")) {
    const rel = ".codex/hooks.json";
    checkWritePath(rel);
    const file = join(project, rel);
    const before = readText(file);
    let next: ReturnType<typeof withCodexHooks>;
    try {
      next = withCodexHooks(before === null ? {} : JSON.parse(before), hook);
    } catch (error) {
      throw invalid(file, error instanceof Error ? error.message : String(error));
    }
    const content = `${JSON.stringify(next.settings, null, 2)}\n`;
    if (before === null || next.changed)
      step(before === null ? "created" : "updated", rel, {
        content,
        apply: () => {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, content);
        },
      });
    else step("kept", rel);

    const machine = planCodexMachine();
    steps.push(...machine.files);
    machineWrites.push(...machine.writes);
    notes.push(bilingual("cook.codex_trust", {}));
  }

  // verid's commands in Claude Code's menu, in this machine's language. One that is there is
  // kept: it may be the developer's own edit, or a teammate's in another language.
  const commands = join(project, ".claude", "commands", "verid");
  const lang = language ?? languageOf(project) ?? "en";
  const commandFiles: PlannedFile[] = (claude ? COMMANDS : []).map((c) => {
    const file = join(commands, `${c}.md`);
    const before = readText(file);
    const text = commandFile(lang, c);
    const action =
      before === null ? "created" : refreshCommands && before !== text ? "updated" : "kept";
    if (action !== "kept")
      writes.push({
        rel: `.claude/commands/verid/${c}.md`,
        content: text,
        apply: () => {
          mkdirSync(commands, { recursive: true });
          writeFileSync(file, text, { flag: action === "created" ? "wx" : "w" });
        },
      });
    return { action, rel: `.claude/commands/verid/${c}.md` };
  });
  if (claude)
    step(
      commandFiles.some((c) => c.action === "updated")
        ? "updated"
        : commandFiles.some((c) => c.action === "created")
          ? "created"
          : "kept",
      ".claude/commands/verid/",
    );
  // Set up by hand from the Phase 0 checklist: the hook would run twice. Only a warning, so a
  // shared settings.json that does not parse is Claude Code's to report, not a reason to stop.
  const shared = parseJson(readText(join(project, ".claude", "settings.json")));
  if (claude && hasVeridHooks(shared)) notes.push(bilingual("init.shared_hooks", {}));

  const apply = () => {
    for (const write of writes) checkWritePath(write.rel);
    for (const write of machineWrites) checkSetupPath(dirname(write.path), basename(write.path));
    if (layout === "workspace") {
      checkWorkspaceRoot(project);
      validateRepoPaths(project, { layout, repos: configured }, true);
    }
    mkdirSync(paths.dir, { recursive: true });
    for (const w of writes) w.apply();
    for (const w of machineWrites) w.apply();
    const lines: string[] = [];
    const errors: string[] = [];
    if (layout === "workspace") initWorkspaceGit(project);
    const setupRepos =
      layout === "workspace"
        ? configured
        : configured.filter(
            (repo) => missing.includes(repo) || existsSync(cloneMarkerFile(project, repo.path)),
          );
    if (setupRepos.length > 0) {
      let cloned = false;
      for (const repo of setupRepos) {
        const result = cloneMissingRepo(project, repo);
        cloned ||= result.missing;
        if (!result.ok) {
          errors.push(
            bilingual(result.incomplete ? "workspace.incomplete" : "workspace.clone_failed", {
              repo: repo.path,
            }),
          );
          if (result.detail) errors.push(result.detail);
        } else if (result.missing) lines.push(bilingual("workspace.cloned", { repo: repo.path }));
      }
      if (!cloned && errors.length === 0) lines.push(bilingual("workspace.already", {}));
    } else if (existing) lines.push(bilingual("workspace.already", {}));
    return {
      failed: errors.length > 0,
      stdout: lines.length ? `${lines.join("\n")}\n` : "",
      stderr: errors.length ? `${errors.join("\n")}\n` : "",
    };
  };
  const files = [...steps.filter((s) => s.rel !== ".claude/commands/verid/"), ...commandFiles];
  for (const write of writes) checkWritePath(write.rel);
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

const COMMANDS = ["tip", "confirm", "peek", "menu"] as const;

/** Installer entry point: register the user-layer role without creating any project files. */
export function setupCodexCommand(): CliResult {
  if (inAgentShell()) throw new VeridError("VERID_BURNT_INIT_IN_AGENT");
  const plan = planCodexMachine();
  for (const write of plan.writes) checkSetupPath(dirname(write.path), basename(write.path));
  for (const write of plan.writes) write.apply();
  return {
    exit: 0,
    stdout: `${setupPreview(plan.files, [bilingual("cook.codex_trust", {})]).join("\n")}\n`,
    stderr: "",
  };
}

function planCodexMachine(): {
  files: PlannedFile[];
  writes: { path: string; content: string; apply: () => void }[];
} {
  const overlay = reviewerOverlay();
  const content = reviewerContent();
  const config = join(codexHome(), "config.toml");
  const reviewer = mergeCodexReviewer(readText(config) ?? undefined, overlay);
  if (!reviewer.ok) throw invalid(config, reviewer.detail);
  const files: PlannedFile[] = [];
  const writes: { path: string; content: string; apply: () => void }[] = [];
  for (const file of [
    { path: overlay, content },
    { path: config, content: reviewer.content },
  ]) {
    checkSetupPath(dirname(file.path), basename(file.path));
    const before = readText(file.path);
    files.push({
      rel: file.path.replaceAll("\\", "/"),
      action: before === null ? "created" : before === file.content ? "kept" : "updated",
    });
    if (before !== file.content)
      writes.push({
        ...file,
        apply: () => {
          mkdirSync(dirname(file.path), { recursive: true });
          writeFileSync(file.path, file.content);
        },
      });
  }
  return { files, writes };
}

/**
 * `/verid:<name>` for Claude Code's menu. The hook reads the line as the developer typed it, so
 * the file only lists the command; its body reaches the agent when the hook lets the prompt
 * through, or when this machine has no verid hooks. The agent never runs one by itself.
 */
function commandFile(lang: Lang, name: (typeof COMMANDS)[number]): string {
  const hint = name === "tip" || name === "confirm" ? t(lang, `command.${name}_hint`, {}) : null;
  return [
    "---",
    `description: ${JSON.stringify(t(lang, `command.${name}`, {}))}`,
    ...(hint === null ? [] : [`argument-hint: ${JSON.stringify(hint)}`]),
    "disable-model-invocation: true",
    "---",
    t(lang, "command.body", {}),
    "",
  ].join("\n");
}

export function projectFacts(project: string, repos: readonly string[] = ["."]): ProjectFacts {
  return {
    sourceDir: repos
      .flatMap((repo) => ["src", "lib", "app"].map((dir) => join(repo, dir)))
      .find((dir) => isDirectory(join(project, dir))),
  };
}

/** What manifestUpgrade() would change, a line per key: `+` adds globs, `−` drops the key. */
export function manifestUpgradeLines(
  manifest: Pick<Manifest, "repos" | "roles"> & Partial<Pick<Manifest, "providers">>,
  missing: readonly string[] = [],
): string[] {
  return [
    ...(manifest.providers?.includes("codex") &&
    !manifest.roles?.reviewer?.includes("verid_reviewer")
      ? ['  + roles.reviewer: "verid_reviewer"']
      : []),
    ...missing.map(
      (key) =>
        `  + ${key}: ${key === "providers" ? '["claude-code"]' : key === "allowed_agents" ? '["general-purpose"]' : "[]"}`,
    ),
    ...manifest.repos.flatMap((repo, i) =>
      upgradeLines({ ...manifestUpgrade(repo, manifest.roles), ...(i > 0 && { roles: null }) }).map(
        (line) =>
          manifest.repos.length > 1 && !line.trimStart().startsWith("+ roles.")
            ? `${repo.path}: ${line}`
            : line,
      ),
    ),
  ];
}

function upgradeLines(up: ReturnType<typeof manifestUpgrade>): string[] {
  const globs = (list: string[]) => list.map((g) => JSON.stringify(g)).join(", ");
  return [
    ...(up.tests.length > 0 ? [`  + test_globs: ${globs(up.tests)}`] : []),
    ...(up.ignore.length > 0 ? [`  + ignore_globs: ${globs(up.ignore)}`] : []),
    ...(up.e2e.length > 0 ? [`  + e2e_globs: ${globs(up.e2e)}`] : []),
    ...ROLE_NAMES.flatMap((r) =>
      up.roles?.[r] ? [`  + roles.${r}: ${JSON.stringify(up.roles[r])}`] : [],
    ),
    ...(up.dropTestCmd ? ["  − test_cmd"] : []),
  ];
}

/** Which test runners verid sees now, as `vitest, maven (api)`, or that it sees none yet. */
export function runnersNote(runners: readonly Runner[]): string {
  const names = runners.map((r) => (r.dir === "." ? r.name : `${r.name} (${r.dir})`)).join(", ");
  return names ? bilingual("cook.runners", { runners: names }) : bilingual("cook.no_runner", {});
}

/** Parsed JSON; a file that is missing or does not parse counts as absent. */
function parseJson(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch (e) {
    if (errno(e) === "ENOENT") return null;
    throw e;
  }
}
